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

// Etapa 99: corte de orçamento da pausa automática de Conjuntos (lib/alerts/adsets-pause.ts).
// Conjunto acima da meta nos últimos 3 dias mas com CPA de 7 dias abaixo do ideal não é
// pausado: o orçamento diário cai R$10, ABO (orçamento no conjunto) ou CBO (orçamento na
// campanha — corta o da campanha). Piso de R$6: nunca deixa o orçamento abaixo disso (o
// mínimo da Meta é perto disso; abaixo ela recusa) — se já está no piso, não corta.
export const DECREASE_CENTS = 1000; // R$10 fixo (valor de cada corte)
export const DECREASE_FLOOR_CENTS = 600; // R$6,00 — piso do orçamento diário

export interface AdSetBudgetInfo {
  scope: "adset" | "campaign";
  targetId: string; // id do conjunto (ABO) ou da campanha (CBO) — quem de fato leva o corte
  campaignId: string | null;
  currentCents: number;
}

export type BudgetInfoResult = { ok: true; info: AdSetBudgetInfo } | { ok: false; reason: "lifetime" | "none" | "error"; error: string; campaignId?: string | null };

interface AdSetBudgetWithCampaign {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign?: { id?: string; daily_budget?: string; lifetime_budget?: string };
}

export async function getAdSetBudgetInfo(token: string, adsetId: string): Promise<BudgetInfoResult> {
  try {
    const r = await metaGet<AdSetBudgetWithCampaign>(token, `/${adsetId}`, {
      fields: "id,daily_budget,lifetime_budget,campaign{id,daily_budget,lifetime_budget}",
    });
    const campaignId = r.campaign?.id ?? null;
    if (r.daily_budget && Number(r.daily_budget) > 0) {
      return { ok: true, info: { scope: "adset", targetId: adsetId, campaignId, currentCents: Number(r.daily_budget) } };
    }
    if (r.lifetime_budget && Number(r.lifetime_budget) > 0) {
      return { ok: false, reason: "lifetime", error: "O conjunto usa orçamento vitalício — não dá pra cortar o diário.", campaignId };
    }
    if (campaignId && r.campaign?.daily_budget && Number(r.campaign.daily_budget) > 0) {
      return { ok: true, info: { scope: "campaign", targetId: campaignId, campaignId, currentCents: Number(r.campaign.daily_budget) } };
    }
    if (r.campaign?.lifetime_budget && Number(r.campaign.lifetime_budget) > 0) {
      return { ok: false, reason: "lifetime", error: "A campanha usa orçamento vitalício — não dá pra cortar o diário.", campaignId };
    }
    return { ok: false, reason: "none", error: "Não achei orçamento diário no conjunto nem na campanha.", campaignId };
  } catch (e) {
    return { ok: false, reason: "error", error: (e as Error).message };
  }
}

// Novo orçamento (centavos) depois do corte de R$10, respeitando o piso. null = já está no
// piso (ou abaixo), não há o que cortar.
export function budgetAfterCut(currentCents: number): number | null {
  if (currentCents <= DECREASE_FLOOR_CENTS) return null;
  return Math.max(currentCents - DECREASE_CENTS, DECREASE_FLOOR_CENTS);
}

export type ApplyCutResult =
  | { ok: true; fromCents: number; toCents: number }
  | { ok: false; floor?: boolean; error: string };

export async function applyBudgetCut(token: string, info: AdSetBudgetInfo): Promise<ApplyCutResult> {
  const next = budgetAfterCut(info.currentCents);
  if (next == null) {
    return { ok: false, floor: true, error: "Orçamento diário já está no piso (R$6) — não dá pra cortar mais." };
  }
  try {
    await metaPost(token, `/${info.targetId}`, { daily_budget: String(next) });
    return { ok: true, fromCents: info.currentCents, toCents: next };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
