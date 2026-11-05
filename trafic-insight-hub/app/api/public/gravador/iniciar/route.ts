import { NextResponse } from "next/server";
import { gravadorAuth } from "@/lib/feedbacks/gravador-auth";
import { startFeedback } from "@/lib/feedbacks/core";

// Etapa 249: a extensão terminou de gravar — cria o feedback e devolve as URLs de upload (lógica em lib/feedbacks/core).
export async function POST(request: Request) {
  const auth = await gravadorAuth(request);
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json(await startFeedback(auth.supabase, auth.userId, await request.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
