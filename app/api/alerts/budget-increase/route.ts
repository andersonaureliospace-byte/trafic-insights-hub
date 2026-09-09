import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkAndIncreaseBudgets } from "@/lib/alerts/increase-budget-auto";

// Sem GET/preview de propósito — mesmo motivo de creatives-pause: o check já
// aumenta o orçamento de quem estiver com CPA bom, só o botão manual (POST)
// existe. Não confundir com /api/analysis/increase-budget (aumento manual
// de UM conjunto por vez, a partir da tela de Análise) — esse aqui roda em
// todas as contas de uma vez, mesma lógica da automação do n8n.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { increased, sendError } = await checkAndIncreaseBudgets(supabase, user.id, token, { send: true });
    return NextResponse.json({ increased, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
