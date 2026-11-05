import { NextResponse, after } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { concludeFeedback, processFeedback } from "@/lib/feedbacks/core";

// Etapa 251: botão "● Gravar" do Hub — o vídeo subiu; transcreve e monta o plano de ação em segundo plano.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const { id } = (await request.json()) as { id?: string };
    const service = createServiceClient();
    await concludeFeedback(service, user.id, String(id ?? ""));
    after(() => processFeedback(service, String(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
