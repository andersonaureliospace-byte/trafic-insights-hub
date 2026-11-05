import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeFeedback } from "@/lib/ai/gemini";
import { sendMedia, sendText, type WhatsappCreds } from "@/lib/whatsapp/client";

// Etapa 249: Clientes → Feedbacks (vídeos da extensão "Gravador de Tela"). Regras compartilhadas entre as rotas públicas
// (que a extensão chama) e as rotas internas (que a aba Feedbacks chama).

export const FEEDBACK_BUCKET = "feedbacks";

// Acima disso o WhatsApp entrega vídeo com dificuldade — manda como arquivo (documento), que chega sempre.
export const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

export type FeedbackStatus = "enviando" | "processando" | "revisao" | "enviado";

export interface FeedbackRow {
  id: string;
  user_id: string;
  ad_account_id: string;
  client_name: string;
  titulo: string;
  status: FeedbackStatus;
  video_path: string | null;
  video_mime: string | null;
  video_bytes: number | null;
  audio_path: string | null;
  audio_mime: string | null;
  duracao_seg: number | null;
  transcricao: string | null;
  resumo: string | null;
  ai_error: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
  sent_at: string | null;
  send_error: string | null;
  created_at: string;
  updated_at: string;
}

export const FEEDBACK_COLUMNS =
  "id, user_id, ad_account_id, client_name, titulo, status, video_path, video_mime, video_bytes, audio_path, audio_mime, duracao_seg, transcricao, resumo, ai_error, wa_group_id, wa_group_name, sent_at, send_error, created_at, updated_at";

const normId = (id: string) => String(id ?? "").replace(/^act_/, "");

export function publicUrl(supabase: SupabaseClient, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(FEEDBACK_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Grupo do cliente: primeiro o grupo atribuído à conta no WhatsApp do Hub estratégico (wa_mirror_chats); se não tiver,
// o grupo antigo da ficha (account_bindings.wa_group_id, usado pelos relatórios do hub operacional).
export async function resolveClientGroup(
  supabase: SupabaseClient,
  userId: string,
  adAccountId: string,
): Promise<{ id: string; name: string } | null> {
  const id = normId(adAccountId);
  const { data: chats } = await supabase.from("wa_mirror_chats").select("chat_jid, name, ad_account_ids").eq("user_id", userId);
  for (const c of (chats ?? []) as Array<{ chat_jid: string; name: string | null; ad_account_ids: string[] | null }>) {
    if ((c.ad_account_ids ?? []).some((a) => normId(a) === id)) return { id: c.chat_jid, name: c.name || c.chat_jid };
  }
  const { data: b } = await supabase
    .from("account_bindings")
    .select("ad_account_id, wa_group_id, wa_group_name")
    .eq("user_id", userId)
    .in("ad_account_id", [id, `act_${id}`]);
  const hit = ((b ?? []) as Array<{ wa_group_id: string | null; wa_group_name: string | null }>).find((x) => x.wa_group_id);
  return hit?.wa_group_id ? { id: hit.wa_group_id, name: hit.wa_group_name || hit.wa_group_id } : null;
}

// Transcreve + resume com o Gemini e deixa "Aguardando revisão". Se a IA falhar, também vai pra revisão (com o erro
// guardado), pra você escrever o resumo à mão ou mandar gerar de novo — nunca fica preso.
export async function processFeedback(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from("client_feedbacks").select(FEEDBACK_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return;
  const row = data as FeedbackRow;
  await supabase.from("client_feedbacks").update({ status: "processando", ai_error: null, updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const result = await summarizeFeedback({
      audio: row.audio_path ? { url: publicUrl(supabase, row.audio_path) as string, mime: row.audio_mime || "audio/mp4" } : null,
      video: row.video_path ? { url: publicUrl(supabase, row.video_path) as string, mime: row.video_mime || "video/mp4" } : null,
      titulo: row.titulo,
      cliente: row.client_name,
    });
    await supabase
      .from("client_feedbacks")
      .update({ status: "revisao", transcricao: result.transcricao, resumo: result.resumo, ai_error: null, updated_at: new Date().toISOString() })
      .eq("id", id);
  } catch (e) {
    await supabase
      .from("client_feedbacks")
      .update({ status: "revisao", ai_error: (e as Error).message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", id);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Envia o vídeo no grupo e, logo depois, o resumo numa mensagem separada (pedido do usuário).
export async function sendFeedback(supabase: SupabaseClient, creds: WhatsappCreds, row: FeedbackRow): Promise<void> {
  if (!row.wa_group_id) throw new Error("Escolha o grupo de WhatsApp antes de enviar.");
  if (!row.video_path) throw new Error("O vídeo não chegou no Hub — grave de novo.");
  const url = publicUrl(supabase, row.video_path) as string;
  const isMp4 = (row.video_mime || "").includes("mp4");
  const asVideo = isMp4 && (row.video_bytes ?? 0) <= WHATSAPP_VIDEO_MAX_BYTES;
  const ext = isMp4 ? "mp4" : "webm";
  const titulo = row.titulo.trim() || "Feedback";
  await sendMedia(creds, row.wa_group_id, {
    url,
    type: asVideo ? "video" : "document",
    caption: `🎥 *${titulo}*`,
    fileName: `${titulo}.${ext}`,
  });
  const resumo = (row.resumo ?? "").trim();
  if (resumo) {
    await sleep(1500); // garante que o resumo chega depois do vídeo
    await sendText(creds, row.wa_group_id, resumo);
  }
}
