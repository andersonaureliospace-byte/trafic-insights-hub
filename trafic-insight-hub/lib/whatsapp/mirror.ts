// Etapa 244: espelho do WhatsApp (Hub estratégico). Busca as mensagens dos grupos escolhidos na Uazapi
// (POST /message/find — mais novas primeiro, com limit/offset) e grava em wa_messages. Não mexe no webhook da
// instância (ele já manda as mensagens pro n8n). A Uazapi guarda só uns dias; o Traffic guarda 90.

import type { createClient } from "@/lib/supabase/server";
import { waFetch, type WhatsappCreds } from "@/lib/whatsapp/client";

type Db = Awaited<ReturnType<typeof createClient>>;

export const MIRROR_DAYS = 90;

interface RawMsg {
  messageid?: string;
  id?: string;
  chatid?: string;
  fromMe?: boolean;
  sender?: string;
  senderName?: string;
  messageType?: string;
  text?: string;
  content?: unknown;
  fileURL?: string;
  quoted?: string;
  messageTimestamp?: number | string;
}

const MEDIA_TYPES = /image|video|audio|ptt|document|sticker/i;
const TYPE_LABEL: Array<[RegExp, string]> = [
  [/image/i, "📷 Imagem"],
  [/video/i, "🎥 Vídeo"],
  [/audio|ptt/i, "🎤 Áudio"],
  [/document/i, "📄 Documento"],
  [/sticker/i, "Figurinha"],
  [/location/i, "📍 Localização"],
  [/contact/i, "👤 Contato"],
  [/poll/i, "📊 Enquete"],
  [/reaction/i, "Reação"],
];

function textOf(m: RawMsg): string {
  if (m.text) return m.text;
  const c = m.content as Record<string, unknown> | string | undefined;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    for (const k of ["text", "caption", "conversation", "title", "fileName"]) {
      if (typeof c[k] === "string" && c[k]) return c[k] as string;
    }
  }
  return "";
}

export function toRow(userId: string, chatJid: string, m: RawMsg) {
  const id = m.messageid || m.id || "";
  const tsNum = Number(m.messageTimestamp ?? 0);
  const ms = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const type = m.messageType ?? "";
  const media = MEDIA_TYPES.test(type) || !!m.fileURL;
  const label = TYPE_LABEL.find(([re]) => re.test(type))?.[1] ?? "";
  const body = textOf(m) || (label ? label : type ? `[${type}]` : "");
  return {
    user_id: userId,
    chat_jid: chatJid,
    message_id: id,
    from_me: !!m.fromMe,
    sender: m.sender ?? null,
    sender_name: m.senderName ?? null,
    msg_type: type || null,
    body,
    has_media: media,
    quoted_id: m.quoted || null,
    ts: new Date(ms || Date.now()).toISOString(),
  };
}

export async function fetchMessages(creds: WhatsappCreds, chatJid: string, limit: number, offset = 0) {
  const j = await waFetch<unknown>(creds, "/message/find", { method: "POST", body: JSON.stringify({ chatid: chatJid, limit, offset }) });
  const root = (j ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(j) ? j : (root.messages as unknown[]) ?? (root.data as unknown[]) ?? []) as RawMsg[];
  return { messages: arr, hasMore: root.hasMore === true || arr.length >= limit };
}

// Grava as mensagens novas de um grupo. Para quando acha uma página que já estava toda salva (ou no limite `max`).
export async function syncChat(db: Db, userId: string, creds: WhatsappCreds, chatJid: string, max = 200): Promise<number> {
  const cutoff = Date.now() - MIRROR_DAYS * 86_400_000;
  let offset = 0;
  let saved = 0;
  const page = Math.min(100, max);
  while (offset < max) {
    const { messages, hasMore } = await fetchMessages(creds, chatJid, page, offset);
    const rows = messages.map((m) => toRow(userId, chatJid, m)).filter((r) => r.message_id && Date.parse(r.ts) >= cutoff);
    if (!rows.length) break;
    const ids = rows.map((r) => r.message_id);
    const { data: existing } = await db.from("wa_messages").select("message_id").eq("user_id", userId).in("message_id", ids);
    const have = new Set((existing ?? []).map((e) => e.message_id as string));
    const fresh = rows.filter((r) => !have.has(r.message_id));
    if (fresh.length) {
      const { error } = await db.from("wa_messages").upsert(fresh, { onConflict: "user_id,message_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      saved += fresh.length;
    }
    if (fresh.length < rows.length || !hasMore) break; // chegou no que já estava salvo
    offset += page;
  }
  // Última mensagem do grupo (pra lista do painel).
  const { data: last } = await db
    .from("wa_messages")
    .select("ts, body, sender_name, from_me")
    .eq("user_id", userId)
    .eq("chat_jid", chatJid)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  await db
    .from("wa_mirror_chats")
    .update({
      synced_at: new Date().toISOString(),
      ...(last
        ? { last_message_at: last.ts, last_preview: `${last.from_me ? "Você" : (last.sender_name ?? "").split(" ")[0] || "—"}: ${String(last.body ?? "").slice(0, 80)}` }
        : {}),
    })
    .eq("user_id", userId)
    .eq("chat_jid", chatJid);
  return saved;
}

export async function purgeOld(db: Db, userId: string) {
  const cutoff = new Date(Date.now() - MIRROR_DAYS * 86_400_000).toISOString();
  await db.from("wa_messages").delete().eq("user_id", userId).lt("ts", cutoff);
}
