import { NextResponse, after } from "next/server";
import { gravadorAuth } from "@/lib/feedbacks/gravador-auth";
import { processFeedback } from "@/lib/feedbacks/core";

// Etapa 249: a extensão terminou de subir os arquivos. Responde na hora e, em segundo plano, transcreve e resume com o
// Gemini — o feedback fica "Aguardando revisão" em Clientes → Feedbacks.
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await gravadorAuth(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;
  try {
    const body = await request.json();
    const id = String(body.id ?? "");
    const { data, error } = await supabase.from("client_feedbacks").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Feedback não encontrado.");
    await supabase.from("client_feedbacks").update({ status: "processando", updated_at: new Date().toISOString() }).eq("id", id);
    after(() => processFeedback(supabase, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
