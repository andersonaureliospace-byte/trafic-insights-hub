import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { readAttentionSnapshot } from "@/lib/alerts/attention-snapshot";
import { buildMorningSummary } from "@/lib/alerts/morning-summary";

// Contas que precisam de atenção (mesma lista do Resumo das 7h) — lido pelo Painel pra pôr o 🚨 e o filtro "Atenção".
// GET = só lê do banco. POST = calcula agora (sem enviar nada pro grupo) e guarda — o Painel chama quando ainda não existe lista.
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json(await readAttentionSnapshot(supabase, user.id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { failedSignals } = await buildMorningSummary(supabase, user.id, token, { send: false });
    return NextResponse.json({ ...(await readAttentionSnapshot(supabase, user.id)), failedSignals });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
