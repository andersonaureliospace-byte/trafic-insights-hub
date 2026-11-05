import { NextResponse, after } from "next/server";
import { gravadorAuth } from "@/lib/feedbacks/gravador-auth";
import { concludeFeedback, processFeedback } from "@/lib/feedbacks/core";

// Etapa 249: a extensão terminou de subir os arquivos. Responde na hora e, em segundo plano, transcreve e monta o plano
// de ação com o Gemini — o feedback fica "Aguardando revisão" em Clientes → Feedbacks.
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await gravadorAuth(request);
  if ("error" in auth) return auth.error;
  try {
    const { id } = (await request.json()) as { id?: string };
    await concludeFeedback(auth.supabase, auth.userId, String(id ?? ""));
    after(() => processFeedback(auth.supabase, String(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
