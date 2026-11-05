import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { processFeedback } from "@/lib/feedbacks/core";

// Etapa 249: botão "Gerar resumo de novo" (ou quando a IA falhou/travou). Roda na hora e devolve quando terminar.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = (await request.json()) as { id?: string };
    const { data } = await supabase.from("client_feedbacks").select("id").eq("id", String(id)).eq("user_id", user.id).maybeSingle();
    if (!data) throw new Error("Feedback não encontrado.");
    await processFeedback(supabase, String(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
