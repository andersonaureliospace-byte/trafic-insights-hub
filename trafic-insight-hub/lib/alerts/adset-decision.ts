// Decisão da pausa automática de Conjuntos (Etapa 99) — lógica pura, sem Meta nem banco,
// pra poder ser testada com cenários. Quem aplica (corta orçamento, pausa, grava a
// quarentena) é lib/alerts/adsets-pause.ts.
//
// Regras (pedido do usuário):
//  1. Conjunto acima da meta nos últimos 3 dias (limite de sempre: 2x a Meta CPA + R$1) e
//     com CPA dos últimos 7 dias ABAIXO do ideal (a "linha verde" de Análise) → NÃO pausa:
//     corta R$10 do orçamento diário (ABO ou CBO) e entra em quarentena de 24h.
//  2. Em quarentena (24h): ignorado — não pausa, não corta de novo.
//  3. Passou a quarentena: se nos últimos 3 dias o CPA continua acima do ideal e nos 7 dias
//     ainda está abaixo do ideal → corta mais R$10 e volta pra quarentena.
//  4. Passou a quarentena: acima do ideal nos 3 dias E nos 7 dias → PAUSA.
//  5. Passou a quarentena e nos 3 dias o CPA não está mais acima do ideal → melhorou: sai da
//     quarentena, nada a fazer.
//  6. Sem registro de quarentena e CPA de 7 dias NÃO abaixo do ideal (ou sem conversa) → pausa,
//     como sempre foi.
//  Conjunto ativo sem nenhum anúncio ativo continua sendo pausado direto (não é questão de
//  desempenho), mesmo em quarentena — EXCETO (Etapa 104) quando tem anúncio em análise,
//  processando, pré-aprovado, com problemas ou aguardando cobrança: esses não são pausados.

import { ADSET_ABOVE_EXTRA, ADSET_ABOVE_MULTIPLIER } from "@/lib/meta/analysis-thresholds";

export interface AdSetMetrics {
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  has_active_ad: boolean;
  has_pending_ad?: boolean; // Etapa 104: sem anúncio ativo, mas com anúncio em análise/processando
}

export type AdSetDecision =
  | { action: "none"; reason: string }
  | { action: "skip"; reason: "quarantine" | "no_7d_data" }
  | { action: "clear"; reason: string }
  | { action: "cut"; reason: string }
  | { action: "pause"; reason: string };

// "Acima do ideal" literal (pra decisão pós-quarentena): custo por conversa maior que a Meta
// CPA; sem conversa, o próprio gasto maior que a Meta CPA (mesma ideia do diffFor de Análise).
export function isAboveIdeal(m: Pick<AdSetMetrics, "spend" | "conversations" | "cost_per_conversation">, cpaTarget: number): boolean {
  const noConversion = !m.conversations || m.conversations <= 0;
  if (noConversion) return m.spend > cpaTarget;
  return m.cost_per_conversation != null && m.cost_per_conversation > cpaTarget;
}

// "Linha verde" de Análise (goodTrend): CPA dos últimos 7 dias estritamente abaixo do ideal.
// Sem conversa nos 7 dias não conta.
export function isBelowIdeal7d(m: Pick<AdSetMetrics, "conversations" | "cost_per_conversation"> | undefined, cpaTarget: number): boolean {
  return !!m && !!m.conversations && m.conversations > 0 && m.cost_per_conversation != null && m.cost_per_conversation < cpaTarget;
}

// Mesmo limite de isAdSetFlaggedAbove (2x a Meta CPA + R$1, com ou sem conversa), sobre as
// métricas já resumidas — sem repetir a regra de "sem anúncio ativo", que a decisão trata antes.
function isFlaggedAbove3d(m: AdSetMetrics, cpaTarget: number): boolean {
  const threshold = cpaTarget * ADSET_ABOVE_MULTIPLIER + ADSET_ABOVE_EXTRA;
  const noConversion = !m.conversations || m.conversations <= 0;
  if (noConversion) return m.spend >= threshold;
  return m.cost_per_conversation != null && m.cost_per_conversation >= threshold;
}

export function decideAdSetAction(input: {
  cpaTarget: number;
  now: Date;
  m3: AdSetMetrics; // últimos 3 dias + hoje
  m7: AdSetMetrics | undefined; // últimos 7 dias (undefined = conjunto sem dado nos 7 dias)
  sevenDayFetched: boolean; // false = a busca de 7 dias falhou (não decide no escuro)
  quarantineUntil: Date | null; // null = nunca entrou em quarentena (sem registro)
}): AdSetDecision {
  const { cpaTarget, now, m3, m7, sevenDayFetched, quarantineUntil } = input;

  if (!m3.has_active_ad) {
    // Etapa 104: anúncio em análise / processando / pré-aprovado etc. ainda vai entrar no ar — não pausa.
    if (m3.has_pending_ad) return { action: "none", reason: "anúncio em análise ou processando" };
    return { action: "pause", reason: "sem anúncio ativo" };
  }

  if (quarantineUntil && quarantineUntil.getTime() > now.getTime()) return { action: "skip", reason: "quarantine" };

  const hasRecord = quarantineUntil != null; // registro já vencido = quarentena acabou
  if (hasRecord) {
    if (!isAboveIdeal(m3, cpaTarget)) return { action: "clear", reason: "voltou pra dentro do ideal nos últimos 3 dias" };
  } else if (!isFlaggedAbove3d(m3, cpaTarget)) {
    return { action: "none", reason: "não está acima do limite" };
  }

  if (!sevenDayFetched) return { action: "skip", reason: "no_7d_data" };

  if (isBelowIdeal7d(m7, cpaTarget)) {
    return { action: "cut", reason: hasRecord ? "ainda acima nos 3 dias, mas 7 dias abaixo do ideal — corta de novo" : "7 dias abaixo do ideal — corta em vez de pausar" };
  }
  return { action: "pause", reason: hasRecord ? "acima do ideal nos 3 e nos 7 dias após a quarentena" : "acima da meta e 7 dias não está abaixo do ideal" };
}
