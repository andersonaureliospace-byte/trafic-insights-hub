import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAdSetBudgetInfo } from "@/lib/meta/budget";
import { metaPost } from "@/lib/meta/client";

// Etapa 218: Análise → "Conjuntos da conta" — muda o orçamento diário de um conjunto pra um valor escolhido na tela.
// Orçamento no conjunto (ABO) muda o do conjunto; orçamento na campanha (CBO) muda o da campanha (avisa na resposta).
// Mínimo R$6 (abaixo disso a Meta recusa).
const MIN_REAIS = 6;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adsetId?: string; dailyBudget?: number };
    const adsetId = String(body.adsetId ?? "").trim();
    const reais = Number(body.dailyBudget);
    if (!adsetId) throw new Error("Conjunto obrigatório.");
    if (!Number.isFinite(reais) || reais < MIN_REAIS) throw new Error(`Orçamento mínimo de R$ ${MIN_REAIS},00.`);
    if (reais > 2000) throw new Error("Valor muito alto — confira o orçamento (máximo R$ 2.000,00 por aqui).");

    const info = await getAdSetBudgetInfo(token, adsetId);
    if (!info.ok) throw new Error(info.error);
    const cents = Math.round(reais * 100);
    await metaPost(token, `/${info.info.targetId}`, { daily_budget: String(cents) });
    return NextResponse.json({
      ok: true,
      scope: info.info.scope,
      fromBudget: info.info.currentCents / 100,
      newBudget: cents / 100,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
