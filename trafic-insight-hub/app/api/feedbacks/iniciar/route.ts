import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { startFeedback } from "@/lib/feedbacks/core";

// Etapa 251: botão "● Gravar" do Hub — mesma coisa que a extensão faz, mas com o login do Hub em vez da chave.
export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    return NextResponse.json(await startFeedback(createServiceClient(), user.id, await request.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
