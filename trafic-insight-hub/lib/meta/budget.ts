// Painel > Análise, aba "abaixo da meta" — aumenta o orçamento diário do
// conjunto num valor fixo pedido pelo usuário (R$2,50), sem porcentagem, sem
// lógica de escala progressiva. Só mexe no orçamento do próprio conjunto
// (adset.daily_budget) — não toca em orçamento de campanha (CBO).
//
// Etapa 53 tinha adicionado uma automação via n8n que fazia esse mesmo
// aumento sozinha 1x/dia; a Etapa 58 removeu essa automação por pedido do
// usuário — hoje esse aumento só acontece manualmente, um conjunto de cada
// vez, pelo botão "Aumentar +R$2,50" de Análise. A Etapa 59 trouxe de volta
// o teto de R$25,00 (criado na Etapa 56 pra automação, removido junto com
// ela na Etapa 58) só que agora aplicado direto ao botão manual: se o
// orçamento diário ATUAL do conjunto (buscado na Meta na hora, nunca
// guardado em banco) já estiver em R$25 ou mais, não aumenta mais.
import { metaGet, metaPost } from "./client";

export const INCREASE_CENTS = 250; // R$2,50 fixo (valor de cada aumento)
export const INCREASE_CAP_CENTS = 2500; // R$25,00 — teto do orçamento diário do conjunto

interface AdSetBudgetFields {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export type IncreaseBudgetResult =
  | { ok: true; newDailyBudget: number }
  | { ok: false; error: string; capped?: boolean };

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
    const currentCents = Number(current.daily_budget);
    if (currentCents >= INCREASE_CAP_CENTS) {
      return {
        ok: false,
        capped: true,
        error: `Orçamento diário já em R$${(INCREASE_CAP_CENTS / 100).toFixed(2).replace(".", ",")} ou mais — não aumenta mais esse conjunto.`,
      };
    }
    let newCents = currentCents + INCREASE_CENTS;
    if (newCents > INCREASE_CAP_CENTS) newCents = INCREASE_CAP_CENTS;
    await metaPost(token, `/${adsetId}`, { daily_budget: String(newCents) });
    return { ok: true, newDailyBudget: newCents / 100 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
