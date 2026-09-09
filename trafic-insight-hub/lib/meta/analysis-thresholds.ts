// Limites de "acima"/"abaixo da meta" usados em Painel > Análise (Conjuntos e
// Criativos) — extraídos pra cá (Etapa 53) pra serem reaproveitados também
// pelas automações de pausa/aumento de orçamento (lib/alerts/*-pause.ts),
// que precisam da EXATA mesma lógica que a tela usa, sem duplicar o cálculo
// em dois lugares e correr o risco de um mudar sem o outro.

import type { AdSetCostRow } from "./adset-cost-analysis";
import type { CreativeCostRow } from "./creative-analysis";

// Conjuntos, aba "CPA acima da meta": passou por 2x (original) → 3x (Etapa
// 44) → 2x + R$1 fixo (Etapa 52) — mesmo limite pros dois casos (com ou sem
// conversa iniciada no período).
export const ADSET_ABOVE_MULTIPLIER = 2;
export const ADSET_ABOVE_EXTRA = 1;

export function isAdSetFlaggedAbove(row: AdSetCostRow, cpaTarget: number): boolean {
  if (!row.has_active_ad) return true; // Etapa 46: avisa mesmo sem bater o limite de CPA
  const threshold = cpaTarget * ADSET_ABOVE_MULTIPLIER + ADSET_ABOVE_EXTRA;
  const noConversion = !row.conversations || row.conversations <= 0;
  if (noConversion) return row.spend >= threshold;
  return row.cost_per_conversation != null && row.cost_per_conversation >= threshold;
}

// Conjuntos, aba "CPA abaixo da meta" (candidatos a receber mais orçamento):
// sem piso de distância da meta, só precisa ter pelo menos 1 conversa
// iniciada no período e custo por conversa menor que a Meta CPA.
export function isAdSetFlaggedBelow(row: AdSetCostRow, cpaTarget: number): boolean {
  return (
    !!row.conversations &&
    row.conversations > 0 &&
    row.cost_per_conversation != null &&
    row.cost_per_conversation < cpaTarget
  );
}

// Criativos: limite mais sensível que o de Conjuntos, de propósito (Etapa
// 40) — R$2 (original) subiu pra R$4 na Etapa 45, com ou sem conversa
// iniciada no período.
export const CREATIVE_ABOVE_TARGET = 4;

export function isCreativeFlaggedAbove(row: CreativeCostRow, cpaTarget: number): boolean {
  const noConversion = !row.conversations || row.conversations <= 0;
  if (noConversion) return row.spend - cpaTarget >= CREATIVE_ABOVE_TARGET;
  return row.cost_per_conversation != null && row.cost_per_conversation - cpaTarget >= CREATIVE_ABOVE_TARGET;
}
