import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { FEEDBACK_COLUMNS, sendFeedback, type FeedbackRow } from "@/lib/feedbacks/core";

// Etapa 249: botão "Enviar pro cliente" — manda o vídeo no grupo e, em seguida, o resumo numa mensagem separada.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { supabase, user } = await requireUser().catch(() => ({ supabase: null, user: null }));
  if (!supabase || !user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  try {
    const { data, error } = await supabase.from("client_feedbacks").select(FEEDBACK_COLUMNS).eq("id", String(id)).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Feedback não encontrado.");
    const row = data as FeedbackRow;
    if (row.status === "enviando") throw new Error("O vídeo ainda não terminou de subir.");
    const inst = await requireWhatsappInstance(supabase, user.id);
    await sendFeedback(supabase, { api_url: inst.api_url, token: inst.token }, row);
    const now = new Date().toISOString();
    await supabase.from("client_feedbacks").update({ status: "enviado", sent_at: now, send_error: null, updated_at: now }).eq("id", row.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (id) await supabase.from("client_feedbacks").update({ send_error: msg.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", String(id)).eq("user_id", user.id);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
