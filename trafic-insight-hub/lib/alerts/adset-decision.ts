// Decisão da pausa automática de Conjuntos (Etapa 99) — lógica pura, sem Meta nem banco,
// pra poder ser testada com cenários. Quem aplica (corta orçamento, pausa, grava a
// quarentena) é lib/alerts/adsets-pause.ts.
//
// Regras (pedido do usuário, versão Etapa 122):
//  0. Só age quando há RESULTADO e o CPA dos últimos 3 dias + hoje está R$4 ou mais acima do ideal.
//     Sem resultado, ou abaixo disso: não mexe em nada.
//  1. Passou da porta acima e com CPA dos últimos 7 dias ABAIXO do ideal (a "linha verde" de
//     Análise) → NÃO pausa: corta R$10 do orçamento diário (ABO ou CBO) e entra em quarentena de 24h.
//  2. Em quarentena (24h): ignorado — não pausa, não corta de novo.
//  3. Passou a quarentena: se nos últimos 3 dias continua R$4+ acima e nos 7 dias ainda está abaixo
//     do ideal → corta mais R$10 e volta pra quarentena.
//  4. Passou a quarentena: R$4+ acima nos 3 dias E 7 dias não abaixo do ideal → PAUSA.
//  5. Passou a quarentena e nos 3 dias o CPA não está mais R$4+ acima (ou sem resultado) → sai da
//     quarentena, nada a fazer.
//  6. Sem registro de quarentena, R$4+ acima e CPA de 7 dias NÃO abaixo do ideal → pausa só se
//     passou do limite de sempre (2x a Meta CPA + R$1); senão não mexe.
//  Conjunto ativo sem nenhum anúncio ativo continua sendo pausado direto (não é questão de
//  desempenho), mesmo em quarentena — EXCETO (Etapas 104/122) quando tem anúncio em QUALQUER outro
//  status vivo (em análise, processando, pré-aprovado, com problemas, reprovado, cobrança…), quando
//  é um conjunto criado há menos de 3h ainda sem anúncio, ou quando a conferência falhou: aí não pausa.
//  Conjunto com anúncio ATIVO nunca é pausado por "falta de anúncio".
//
// Etapa 122 (pedido do Anderson) — regra de DESEMPENHO só mexe quando há resultado e o CPA está
// pelo menos R$4 acima do ideal (ADSET_CUT_EXTRA). Conjunto sem resultado (nenhuma conversa) ou com
// CPA abaixo de ideal + R$4: não mexe em nada (nem corta, nem pausa) — e se estava em quarentena, só
// sai dela. Dentro disso: 7 dias abaixo do ideal → corta R$10 + quarentena; 7 dias não abaixo → pausa,
// mas a primeira pausa continua exigindo o limite de sempre (2x a Meta CPA + R$1).

import { ADSET_ABOVE_EXTRA, ADSET_ABOVE_MULTIPLIER, ADSET_CUT_EXTRA } from "@/lib/meta/analysis-thresholds";

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

// Etapa 122: porta de entrada de qualquer ação de desempenho — tem resultado (pelo menos 1 conversa) e o
// custo por conversa dos últimos 3 dias + hoje está R$4 ou mais ACIMA do ideal. Sem resultado: não mexe.
export function passesCutGate(m: Pick<AdSetMetrics, "conversations" | "cost_per_conversation">, cpaTarget: number): boolean {
  if (!m.conversations || m.conversations <= 0) return false;
  return m.cost_per_conversation != null && m.cost_per_conversation >= cpaTarget + ADSET_CUT_EXTRA;
}

// Limite "de sempre" da primeira pausa (2x a Meta CPA + R$1), só com resultado.
function isFlaggedAbove3d(m: AdSetMetrics, cpaTarget: number): boolean {
  const threshold = cpaTarget * ADSET_ABOVE_MULTIPLIER + ADSET_ABOVE_EXTRA;
  if (!m.conversations || m.conversations <= 0) return false;
  return m.cost_per_conversation != null && m.cost_per_conversation >= threshold;
}

// A busca dos 7 dias só é necessária pra conjunto com anúncio ativo, fora da quarentena e que passa da porta de
// desempenho (usado por adsets-pause.ts pra não buscar 7 dias à toa).
export function needsSevenDayData(m3: AdSetMetrics, cpaTarget: number, quarantineUntil: Date | null, now: Date): boolean {
  if (!m3.has_active_ad) return false;
  if (quarantineUntil && quarantineUntil.getTime() > now.getTime()) return false;
  return passesCutGate(m3, cpaTarget);
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
    // Etapas 104/122: anúncio em outro status vivo, conjunto novo ou conferência que falhou — não pausa.
    if (m3.has_pending_ad) return { action: "none", reason: "tem anúncio em análise/processando/outro status (ou conjunto novo) — não pausa" };
    return { action: "pause", reason: "sem anúncio ativo" };
  }

  if (quarantineUntil && quarantineUntil.getTime() > now.getTime()) return { action: "skip", reason: "quarantine" };

  const hasRecord = quarantineUntil != null; // registro já vencido = quarentena acabou

  // Etapa 122: sem resultado, ou CPA a menos de R$4 acima do ideal → não mexe em nada.
  if (!passesCutGate(m3, cpaTarget)) {
    return hasRecord
      ? { action: "clear", reason: "sem resultado ou CPA a menos de R$4 acima do ideal" }
      : { action: "none", reason: "sem resultado ou CPA a menos de R$4 acima do ideal — não mexe" };
  }

  if (!sevenDayFetched) return { action: "skip", reason: "no_7d_data" };

  if (isBelowIdeal7d(m7, cpaTarget)) {
    return { action: "cut", reason: hasRecord ? "ainda R$4+ acima nos 3 dias, mas 7 dias abaixo do ideal — corta de novo" : "R$4+ acima nos 3 dias e 7 dias abaixo do ideal — corta em vez de pausar" };
  }
  // 7 dias NÃO abaixo do ideal: pausa — depois da quarentena direto; na primeira vez só se passou do limite de sempre.
  if (hasRecord) return { action: "pause", reason: "R$4+ acima nos 3 dias e 7 dias não abaixo do ideal após a quarentena" };
  if (isFlaggedAbove3d(m3, cpaTarget)) return { action: "pause", reason: "acima do limite (2x + R$1) e 7 dias não está abaixo do ideal" };
  return { action: "none", reason: "R$4+ acima, mas 7 dias não abaixo do ideal e ainda sem passar do limite de pausa" };
}
