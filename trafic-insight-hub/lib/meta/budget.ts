// Painel > Análise, aba "abaixo da meta" — aumenta o orçamento diário do
// conjunto num valor fixo pedido pelo usuário (R$2,50), sem porcentagem, sem
// lógica de escala progressiva. Só mexe no orçamento do próprio conjunto
// (adset.daily_budget) — não toca em orçamento de campanha (CBO). O botão
// manual de Análise nunca tem teto (`opts.capCents` fica de fora); só a
// automação (lib/alerts/increase-budget-auto.ts, Etapa 56) passa
// `capCents: AUTO_INCREASE_CAP_CENTS`.
import { metaGet, metaPost } from "./client";

export const INCREASE_CENTS = 250; // R$2,50 fixo (valor de cada aumento)

// Etapa 56: teto do orçamento diário ATUAL do conjunto (não um acumulado de
// quanto já foi somado) — pedido explícito: "se o orçamento daquele
// conjunto for igual a 25, não é pra aumentar mais". Só vale pra automação
// (increase-budget-tick); o botão manual de Análise não tem teto. Compara
// sempre o orçamento diário DE VERDADE do conjunto, buscado na Meta na hora
// (não guarda nada em banco) — então também cobre um conjunto que já
// estivesse com orçamento igual/maior que R$25 antes mesmo de a automação
// rodar (nesse caso ela simplesmente nunca aumenta esse conjunto).
export const AUTO_INCREASE_CAP_CENTS = 2500; // R$25,00

interface AdSetBudgetFields {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export type IncreaseBudgetResult =
  | { ok: true; newDailyBudget: number }
  | { ok: false; error: string; capped?: boolean };

export async function increaseAdSetDailyBudget(
  token: string,
  adsetId: string,
  opts: { capCents?: number } = {},
): Promise<IncreaseBudgetResult> {
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
    if (opts.capCents != null && currentCents >= opts.capCents) {
      return {
        ok: false,
        capped: true,
        error: `Orçamento diário já em ${(opts.capCents / 100).toFixed(2).replace(".", ",")} ou mais — limite automático, não aumenta mais sozinho.`,
      };
    }
    let newCents = currentCents + INCREASE_CENTS;
    if (opts.capCents != null && newCents > opts.capCents) newCents = opts.capCents;
    await metaPost(token, `/${adsetId}`, { daily_budget: String(newCents) });
    return { ok: true, newDailyBudget: newCents / 100 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
