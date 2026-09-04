// Painel > Análise, aba "abaixo da meta" — aumenta o orçamento diário do
// conjunto num valor fixo pedido pelo usuário (R$2,50), sem porcentagem, sem
// lógica de escala progressiva. Só mexe no orçamento do próprio conjunto
// (adset.daily_budget) — não toca em orçamento de campanha (CBO).
import { metaGet, metaPost } from "./client";

const INCREASE_CENTS = 250; // R$2,50 fixo

interface AdSetBudgetFields {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export type IncreaseBudgetResult =
  | { ok: true; newDailyBudget: number }
  | { ok: false; error: string };

export async function increaseAdSetDailyBudget(token: string, adsetId: string): Promise<IncreaseBudgetResult> {
  try {
    const current = await metaGet<AdSetBudgetFields>(token, `/${adsetId}`, {
      fields: "id,daily_budget,lifetime_budget",
    });
    if (!current.daily_budget) {
      return {
        ok: false,
        error: current.lifetime_budget
          ? "Esse conjunto usa orçamento vitalício (lifetime), não orçamento diário — não dá pra aumentar R$2,50/dia por aqui."
          : "Esse conjunto não tem orçamento próprio pra aumentar (o orçamento está na campanha, CBO).",
      };
    }
    const newCents = Number(current.daily_budget) + INCREASE_CENTS;
    await metaPost(token, `/${adsetId}`, { daily_budget: String(newCents) });
    return { ok: true, newDailyBudget: newCents / 100 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
