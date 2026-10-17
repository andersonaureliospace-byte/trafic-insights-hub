import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { buildMorningSummary } from "@/lib/alerts/morning-summary";

// Etapa 137: prévia do Resumo das 7h pela sessão do usuário. GET = só mostra o texto (não envia nada);
// POST = monta e envia agora pro grupo + aba Alertas (igual ao hook das 7h).
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { text, ranked, failedSignals } = await buildMorningSummary(supabase, user.id, token, { send: false });
    return NextResponse.json({ text, accounts: ranked.length, failedSignals });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { text, ranked, failedSignals, sendError } = await buildMorningSummary(supabase, user.id, token, { send: true });
    return NextResponse.json({ text, accounts: ranked.length, failedSignals, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
