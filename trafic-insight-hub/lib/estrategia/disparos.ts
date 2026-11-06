// Etapa 270: Disparos em massa em segundo plano. O disparo e a fila de grupos ficam no Supabase (estr_disparos /
// estr_disparo_itens); cada "rodada" do servidor manda grupos por até ~45s respeitando o intervalo sorteado entre eles e,
// se ainda sobrar fila, chama a si mesma (hook disparo-run). Se a corrente quebrar, quem reacende é: o Hub aberto em
// qualquer tela (a cada 30s) e a batida das Auditorias (a cada 15 min).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendMedia, sendText, type WhatsappCreds, type WhatsappMediaType } from "@/lib/whatsapp/client";
import { WHATSAPP_VIDEO_MAX_BYTES } from "@/lib/feedbacks/core";

export interface DisparoPart {
  kind: "text" | "media";
  text?: string;
  url?: string;
  mime?: string;
  fileName?: string;
  bytes?: number;
}

export interface DisparoAlvo {
  id: string;
  name: string;
  cliente: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCK_MS = 58_000;

function mediaKind(mime: string, bytes: number): WhatsappMediaType {
  if (mime.startsWith("image/")) return "image";
  // O WhatsApp só toca como vídeo até ~16 MB e em MP4; acima disso vai como arquivo (igual aos Feedbacks).
  if (mime.startsWith("video/")) return mime.includes("mp4") && bytes <= WHATSAPP_VIDEO_MAX_BYTES ? "video" : "document";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function cleanParts(raw: unknown): DisparoPart[] {
  const list = (Array.isArray(raw) ? raw : []) as DisparoPart[];
  const parts = list
    .map((p) => ({
      kind: p.kind === "media" ? ("media" as const) : ("text" as const),
      text: String(p.text ?? "").slice(0, 4096),
      url: p.kind === "media" ? String(p.url ?? "") : undefined,
      mime: p.kind === "media" ? String(p.mime ?? "") : undefined,
      fileName: p.kind === "media" ? String(p.fileName ?? "") : undefined,
      bytes: p.kind === "media" ? Number(p.bytes ?? 0) : undefined,
    }))
    .filter((p) => (p.kind === "media" ? /^https?:\/\//.test(p.url ?? "") : p.text.trim()));
  if (parts.length === 0) throw new Error("Nada pra enviar.");
  if (parts.length > 10) throw new Error("No máximo 10 mensagens por disparo.");
  return parts;
}

export async function createDisparo(
  db: SupabaseClient,
  userId: string,
  input: { parts: DisparoPart[]; alvos: DisparoAlvo[]; intervalMin: number; intervalMax: number },
): Promise<string> {
  const alvos = input.alvos.filter((a) => String(a.id).endsWith("@g.us"));
  if (alvos.length === 0) throw new Error("Escolha ao menos um grupo.");
  const min = Math.max(3, Math.min(120, Math.round(input.intervalMin)));
  const max = Math.max(min, Math.min(180, Math.round(input.intervalMax)));
  const primeiroTexto = input.parts.map((p) => p.text ?? "").find((t) => t.trim()) ?? "";
  const midias = input.parts.filter((p) => p.kind === "media").length;
  const resumo = `${midias ? `📎${midias} ` : ""}${primeiroTexto.replace(/\s+/g, " ").trim()}`.slice(0, 140);
  const { data, error } = await db
    .from("estr_disparos")
    .insert({ user_id: userId, parts: input.parts, resumo, interval_min: min, interval_max: max, total: alvos.length })
    .select("id")
    .single();
  if (error) {
    if (/estr_disparo/.test(error.message)) throw new Error("Rode o SQL supabase/migrations/0045_disparos.sql no Supabase.");
    throw error;
  }
  const id = data.id as string;
  const rows = alvos.map((a, i) => ({
    disparo_id: id,
    user_id: userId,
    ordem: i,
    group_id: a.id,
    group_name: String(a.name ?? "").slice(0, 200),
    cliente: String(a.cliente ?? a.name ?? "").slice(0, 300),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e2 } = await db.from("estr_disparo_itens").insert(rows.slice(i, i + 500));
    if (e2) throw e2;
  }
  return id;
}

async function sendPart(creds: WhatsappCreds, groupId: string, cliente: string, p: DisparoPart) {
  const fill = (t: string) => t.replaceAll("{cliente}", cliente);
  if (p.kind === "media" && p.url) {
    await sendMedia(creds, groupId, { url: p.url, type: mediaKind(p.mime ?? "", Number(p.bytes ?? 0)), caption: fill(p.text ?? ""), fileName: p.fileName });
  } else {
    const text = fill(p.text ?? "").trim();
    if (text) await sendText(creds, groupId, text);
  }
}

// Tempo que precisa sobrar antes de começar um bloco: vídeo/imagem a Uazapi ainda baixa o arquivo, pode demorar.
const roomFor = (p: DisparoPart) => (p.kind === "media" ? 25_000 : 8_000);

async function recount(db: SupabaseClient, id: string) {
  const [{ count: ok }, { count: erro }, { count: pend }] = await Promise.all([
    db.from("estr_disparo_itens").select("id", { count: "exact", head: true }).eq("disparo_id", id).eq("status", "ok"),
    db.from("estr_disparo_itens").select("id", { count: "exact", head: true }).eq("disparo_id", id).eq("status", "erro"),
    db.from("estr_disparo_itens").select("id", { count: "exact", head: true }).eq("disparo_id", id).eq("status", "pendente"),
  ]);
  return { ok: ok ?? 0, erro: erro ?? 0, pendentes: pend ?? 0 };
}

// Uma rodada: pega os disparos "rodando" do usuário e manda o que der até o prazo. Devolve se ainda ficou fila.
export async function runDisparos(db: SupabaseClient, userId: string, budgetMs = 40_000): Promise<{ sent: number; pending: boolean }> {
  const deadline = Date.now() + budgetMs;
  let sent = 0;
  let pending = false;
  const { data: ativos } = await db
    .from("estr_disparos")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "rodando")
    .order("created_at", { ascending: true })
    .limit(5);
  if (!ativos?.length) return { sent, pending };

  const inst = await getWhatsappInstance(db as never, userId);
  if (!inst?.api_url || !inst?.token) {
    for (const a of ativos) await db.from("estr_disparos").update({ last_error: "WhatsApp não configurado em Conexões." }).eq("id", a.id);
    return { sent, pending: false };
  }
  const creds = { api_url: inst.api_url, token: inst.token };

  for (const a of ativos) {
    if (Date.now() > deadline - 20_000) {
      pending = true;
      break;
    }
    const id = a.id as string;
    // trava: só uma rodada mexe nesse disparo por vez (evita mandar duas vezes no mesmo grupo)
    const nowIso = new Date().toISOString();
    const { data: got } = await db
      .from("estr_disparos")
      .update({ lock_until: new Date(Date.now() + LOCK_MS).toISOString() })
      .eq("id", id)
      .eq("status", "rodando")
      .or(`lock_until.is.null,lock_until.lt.${nowIso}`)
      .select("id, parts, interval_min, interval_max, next_at")
      .maybeSingle();
    if (!got) continue; // outra rodada está cuidando (e ela mesma chama a próxima)
    const parts = (got.parts ?? []) as DisparoPart[];
    let nextAt = new Date(got.next_at as string).getTime();
    try {
      for (;;) {
        const { data: st } = await db.from("estr_disparos").select("status").eq("id", id).maybeSingle();
        if (st?.status !== "rodando") break;
        const { data: item } = await db
          .from("estr_disparo_itens")
          .select("id, group_id, cliente, parte")
          .eq("disparo_id", id)
          .eq("status", "pendente")
          .order("ordem", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!item) break;
        let parte = Number(item.parte ?? 0);
        // Grupo novo: respeita o intervalo. Grupo pela metade (rodada anterior parou no meio): continua direto.
        if (parte === 0) {
          const wait = nextAt - Date.now();
          const room = deadline - roomFor(parts[0]) - Date.now();
          if (wait > room) {
            if (room > 0) await sleep(room);
            pending = true;
            break;
          }
          if (wait > 0) await sleep(wait);
        }
        // Um bloco por vez, salvando o progresso: se a rodada acabar no meio, a próxima continua do bloco certo.
        let falhou = false;
        let cortou = false;
        while (parte < parts.length) {
          if (Date.now() > deadline - roomFor(parts[parte])) {
            cortou = true;
            break;
          }
          if (parte > 0) await sleep(1500); // mantém a ordem no WhatsApp
          try {
            await sendPart(creds, item.group_id as string, (item.cliente as string) || "", parts[parte]);
          } catch (e) {
            await db.from("estr_disparo_itens").update({ status: "erro", parte, error: `Bloco ${parte + 1}: ${(e as Error).message}`.slice(0, 500), sent_at: new Date().toISOString() }).eq("id", item.id);
            falhou = true;
            break;
          }
          parte++;
          await db.from("estr_disparo_itens").update({ parte }).eq("id", item.id);
          await db.from("estr_disparos").update({ lock_until: new Date(Date.now() + LOCK_MS).toISOString() }).eq("id", id);
        }
        if (cortou) {
          pending = true;
          break;
        }
        if (!falhou) await db.from("estr_disparo_itens").update({ status: "ok", error: null, sent_at: new Date().toISOString() }).eq("id", item.id);
        sent++;
        const min = Number(got.interval_min ?? 10);
        const max = Number(got.interval_max ?? 20);
        nextAt = Date.now() + Math.round((min + Math.random() * (max - min)) * 1000);
        await db.from("estr_disparos").update({ next_at: new Date(nextAt).toISOString(), lock_until: new Date(Date.now() + LOCK_MS).toISOString() }).eq("id", id);
      }
    } finally {
      const c = await recount(db, id);
      const { data: st } = await db.from("estr_disparos").select("status").eq("id", id).maybeSingle();
      const done = st?.status === "rodando" && c.pendentes === 0;
      if (st?.status === "rodando" && c.pendentes > 0) pending = true;
      await db
        .from("estr_disparos")
        .update({
          ok: c.ok,
          erro: c.erro,
          lock_until: null,
          updated_at: new Date().toISOString(),
          ...(done ? { status: "concluido", finished_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
    }
  }
  return { sent, pending };
}

// Chama a próxima rodada no servidor (não espera ela terminar).
export async function chainDisparos(origin: string): Promise<void> {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return;
  await fetch(`${origin}/api/public/hooks/disparo-run`, {
    method: "POST",
    headers: { "x-webhook-secret": secret },
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
}

// Tem disparo rodando parado há mais de 2 min (corrente quebrou)? — usado pela batida das Auditorias e pelo Hub aberto.
export async function hasStalledDisparo(db: SupabaseClient, userId: string): Promise<boolean> {
  const limit = new Date(Date.now() - 120_000).toISOString();
  const { data } = await db
    .from("estr_disparos")
    .select("id, next_at, lock_until")
    .eq("user_id", userId)
    .eq("status", "rodando")
    .lt("next_at", limit)
    .limit(5);
  const now = Date.now();
  return (data ?? []).some((d) => !d.lock_until || new Date(d.lock_until as string).getTime() < now);
}
