import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { listGroups, sendMedia, sendText, type WhatsappMediaType } from "@/lib/whatsapp/client";
import { FEEDBACK_BUCKET, WHATSAPP_VIDEO_MAX_BYTES } from "@/lib/feedbacks/core";

// Etapa 266: Disparos em massa (Hub estratégico).
//   GET  (?force=1)                      → grupos do WhatsApp + de quais clientes/gestores cada um é
//   POST { action: "upload", ... }       → URL assinada pra subir a imagem/vídeo DIRETO pro Storage (sem o limite de 4,5 MB da Vercel)
//   POST { action: "send", groupId, parts } → manda as partes, em ordem, num grupo. O navegador chama um grupo por vez,
//                                             com intervalo entre eles (sem estourar os 60s da função e sem cara de spam).
export const maxDuration = 60;

const normId = (id: string) => String(id ?? "").replace(/^act_/, "");
const UPLOAD_LIMIT = 50 * 1024 * 1024;
const FOLDER = "disparos";
const KEEP_DAYS = 7;

interface ClienteRef {
  id: string;
  name: string;
  responsible: string | null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const force = new URL(request.url).searchParams.get("force") === "1";
    const [groups, { data: binds }, { data: chats }, { data: gRow }] = await Promise.all([
      listGroups(inst, force),
      supabase.from("account_bindings").select("ad_account_id, client_name, responsible, wa_group_id, archived").eq("user_id", user.id),
      supabase.from("wa_mirror_chats").select("chat_jid, ad_account_ids").eq("user_id", user.id),
      supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle(),
    ]);

    const byAcc = new Map<string, ClienteRef>();
    for (const b of binds ?? []) {
      if (b.archived) continue;
      const id = normId(b.ad_account_id as string);
      byAcc.set(id, { id, name: ((b.client_name as string | null) ?? "").trim() || id, responsible: ((b.responsible as string | null) ?? "").trim() || null });
    }
    // Mesmo vínculo do resto do Hub: grupo atribuído no WhatsApp do Hub estratégico; se não, o grupo antigo da ficha.
    const clientsOf = new Map<string, Map<string, ClienteRef>>();
    const link = (jid: string, accId: string) => {
      const c = byAcc.get(normId(accId));
      if (!jid || !c) return;
      if (!clientsOf.has(jid)) clientsOf.set(jid, new Map());
      clientsOf.get(jid)!.set(c.id, c);
    };
    for (const c of chats ?? []) for (const a of (c.ad_account_ids as string[] | null) ?? []) link(c.chat_jid as string, a);
    for (const b of binds ?? []) if (b.wa_group_id) link(b.wa_group_id as string, b.ad_account_id as string);

    const list = groups
      .map((g) => ({ id: g.id, name: g.name, clientes: [...(clientsOf.get(g.id)?.values() ?? [])] }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const gestores = Array.isArray(gRow?.pref_value)
      ? (gRow!.pref_value as Array<{ name?: string }>).map((g) => String(g?.name ?? "").trim()).filter(Boolean)
      : [];
    return NextResponse.json({ groups: list, gestores });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

interface Part {
  kind: "text" | "media";
  text?: string;
  url?: string;
  mime?: string;
  fileName?: string;
  bytes?: number;
}

function mediaKind(mime: string, bytes: number): WhatsappMediaType {
  if (mime.startsWith("image/")) return "image";
  // O WhatsApp só toca como vídeo até ~16 MB e em MP4; acima disso vai como arquivo (igual aos Feedbacks).
  if (mime.startsWith("video/")) return mime.includes("mp4") && bytes <= WHATSAPP_VIDEO_MAX_BYTES ? "video" : "document";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Apaga os anexos de disparos com mais de 7 dias (a Uazapi só precisa do link na hora do envio).
async function purgeOld(service: ReturnType<typeof createServiceClient>, userId: string) {
  const storage = service.storage.from(FEEDBACK_BUCKET);
  const { data } = await storage.list(`${userId}/${FOLDER}`, { limit: 1000 });
  const limit = Date.now() - KEEP_DAYS * 86_400_000;
  const old = (data ?? []).filter((f) => f.created_at && new Date(f.created_at).getTime() < limit).map((f) => `${userId}/${FOLDER}/${f.name}`);
  if (old.length) await storage.remove(old);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "upload") {
      const bytes = Number(body.bytes ?? 0);
      const name = String(body.name ?? "arquivo");
      if (bytes > UPLOAD_LIMIT) throw new Error(`"${name}" tem ${(bytes / 1048576).toFixed(0)} MB e o limite é 50 MB.`);
      const service = createServiceClient();
      await purgeOld(service, user.id).catch(() => {});
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
      const path = `${user.id}/${FOLDER}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext ? `.${ext}` : ""}`;
      const storage = service.storage.from(FEEDBACK_BUCKET);
      const signed = await storage.createSignedUploadUrl(path);
      if (signed.error) throw new Error(`Storage: ${signed.error.message}`);
      return NextResponse.json({
        upload_url: signed.data.signedUrl,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
        url: storage.getPublicUrl(path).data.publicUrl,
        path,
      });
    }

    if (body.action === "send") {
      const groupId = String(body.groupId ?? "").trim();
      const parts = (Array.isArray(body.parts) ? body.parts : []) as Part[];
      if (!groupId.endsWith("@g.us")) throw new Error("Grupo inválido.");
      if (parts.length === 0) throw new Error("Nada pra enviar.");
      if (parts.length > 10) throw new Error("No máximo 10 mensagens por disparo.");
      const inst = await requireWhatsappInstance(supabase, user.id);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (i > 0) await sleep(1500); // mantém a ordem no WhatsApp
        if (p.kind === "media" && p.url) {
          const mime = String(p.mime ?? "");
          await sendMedia(inst, groupId, { url: p.url, type: mediaKind(mime, Number(p.bytes ?? 0)), caption: p.text ?? "", fileName: p.fileName });
        } else {
          const text = String(p.text ?? "").trim();
          if (!text) continue;
          if (text.length > 4096) throw new Error("Texto passou de 4.096 caracteres.");
          await sendText(inst, groupId, text);
        }
      }
      return NextResponse.json({ ok: true });
    }

    throw new Error("Ação desconhecida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
