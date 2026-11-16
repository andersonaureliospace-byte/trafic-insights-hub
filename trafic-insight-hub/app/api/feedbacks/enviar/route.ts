import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { enviarFeedback } from "@/lib/feedbacks/enviar";

// Etapa 249: botão "Enviar pro cliente" — manda o vídeo/prints no grupo e, em seguida, o resumo numa mensagem separada.
// Etapa 315: a lógica foi pra lib/feedbacks/enviar.ts (o envio programado usa a mesma).
export const maxDuration = 60;

export async function POST(request: Request) {
  const { supabase, user } = await requireUser().catch(() => ({ supabase: null, user: null }));
  if (!supabase || !user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { id, proximo } = (await request.json().catch(() => ({}))) as { id?: string; proximo?: string };
  try {
    const tarefa = await enviarFeedback(supabase as never, user.id, String(id), proximo);
    return NextResponse.json({ ok: true, tarefa });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
