import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { applyBudgetIncreases, listBudgetPlan, planBudgetIncreases, skipPlannedIncrease } from "@/lib/alerts/budget-increase";

// Etapa 139: sub-área "Aumento programado" de Análise.
//  GET  → plano de hoje + histórico dos últimos dias
//  POST { action: "plan" }            → refaz o plano agora (só calcula)
//  POST { action: "apply", adsetIds? } → aplica agora o que está planejado (todos ou só os ids)
//  POST { action: "skip", adsetId }    → tira um conjunto do plano de hoje
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json({ rows: await listBudgetPlan(supabase, user.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { action?: string; adsetId?: string; adsetIds?: string[] };
    if (body.action === "skip") {
      if (!body.adsetId) return NextResponse.json({ error: "adsetId obrigatório" }, { status: 400 });
      await skipPlannedIncrease(supabase, user.id, body.adsetId);
      return NextResponse.json({ ok: true });
    }
    const token = await getUserMetaToken(supabase, user.id);
    if (body.action === "plan") {
      return NextResponse.json({ ok: true, ...(await planBudgetIncreases(supabase, user.id, token)) });
    }
    if (body.action === "apply") {
      return NextResponse.json({ ok: true, ...(await applyBudgetIncreases(supabase, user.id, token, { send: true, adsetIds: body.adsetIds })) });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
