// Acompanhamento de metas (Etapa 82) — cálculo puro (sem React, sem Meta),
// modelado no dashboard de referência da Speed. Tudo é "até ontem": o
// investimento e o CPA vêm do preset this_month_until_yesterday (dia 01 até
// ontem, dias já fechados), e o ideal é proporcional a esses mesmos dias.

import { monthCalendarSP } from "./ritmo";

// CPA: diferença (CPA − CPA ideal) até R$1,40 acima do ideal = aceitável
// (laranja); acima disso = crítico (vermelho); abaixo/igual ao ideal = verde.
// Mesma banda de cpaDiffColorClass (Acompanhamento) — e bate com a Speed
// ("Dentro do aceitável" em +R$1,32, "Acima da meta" em +R$1,62).
export const CPA_ACCEPTABLE_BAND = 1.4;

// Investimento: dentro de 80%–120% do ideal até ontem = "dentro da meta".
// O limite de baixo (80%) foi deduzido da Speed (conta com 83% do ideal já
// aparece verde, com 77% ainda aparece laranja "Faltam"). O de cima (120%)
// é palpite — a Speed não mostra nenhuma conta muito acima do ideal.
export const INVEST_LOW_RATIO = 0.8;
export const INVEST_HIGH_RATIO = 1.2;

export type InvestStatus = "below" | "ok" | "above";
export type CpaStatus = "good" | "acceptable" | "high";

export interface MetasInput {
  invested: number; // gasto do dia 01 até ontem
  monthlyTarget: number | null; // Investimento mensal cadastrado
  cpa: number | null; // CPA do dia 01 até ontem
  cpaTarget: number | null; // CPA ideal cadastrado
}

export interface MetasRow {
  invested: number;
  monthlyTarget: number | null;
  idealUntilYesterday: number | null;
  pctOfTarget: number | null; // investido ÷ meta mensal (0-1+)
  investDiff: number | null; // investido − ideal (R$; negativo = faltou)
  investRatio: number | null; // investido ÷ ideal
  investStatus: InvestStatus | null;
  cpa: number | null;
  cpaTarget: number | null;
  cpaDiff: number | null; // CPA − CPA ideal
  cpaStatus: CpaStatus | null;
}

// Dias já fechados do mês corrente (até ontem) e dias reais do mês — mesma
// base do Ritmo (monthCalendarSP). No dia 01 não há nenhum dia fechado ainda.
export function metasCalendar(now: Date = new Date()): {
  closedDays: number;
  daysInMonth: number;
  untilLabel: string; // "dd/mm" do último dia fechado ("" no dia 01)
} {
  const { month, day, daysInMonth } = monthCalendarSP(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { closedDays: day - 1, daysInMonth, untilLabel: day > 1 ? `${pad(day - 1)}/${pad(month)}` : "" };
}

export function computeMetas(input: MetasInput, closedDays: number, daysInMonth: number): MetasRow {
  const { invested, monthlyTarget, cpa, cpaTarget } = input;

  const hasMonthly = monthlyTarget != null && monthlyTarget > 0;
  const idealUntilYesterday =
    hasMonthly && closedDays > 0 ? (monthlyTarget / daysInMonth) * closedDays : null;
  const pctOfTarget = hasMonthly ? invested / monthlyTarget : null;
  const investDiff = idealUntilYesterday != null ? invested - idealUntilYesterday : null;
  const investRatio = idealUntilYesterday != null && idealUntilYesterday > 0 ? invested / idealUntilYesterday : null;
  let investStatus: InvestStatus | null = null;
  if (investRatio != null) {
    investStatus = investRatio < INVEST_LOW_RATIO ? "below" : investRatio > INVEST_HIGH_RATIO ? "above" : "ok";
  }

  const cpaDiff = cpa != null && cpaTarget != null ? cpa - cpaTarget : null;
  let cpaStatus: CpaStatus | null = null;
  if (cpaDiff != null) {
    cpaStatus = cpaDiff <= 0 ? "good" : cpaDiff <= CPA_ACCEPTABLE_BAND ? "acceptable" : "high";
  }

  return {
    invested,
    monthlyTarget: hasMonthly ? monthlyTarget : null,
    idealUntilYesterday,
    pctOfTarget,
    investDiff,
    investRatio,
    investStatus,
    cpa,
    cpaTarget,
    cpaDiff,
    cpaStatus,
  };
}

export type MetasSort = "critical" | "cpa" | "invest_above" | "invest_below";

export const METAS_SORTS: { id: MetasSort; label: string }[] = [
  { id: "critical", label: "Mais crítica (CPA alto + investimento fora)" },
  { id: "cpa", label: "CPA elevado (maior → menor)" },
  { id: "invest_above", label: "Investimento fora pra cima (maior diferença)" },
  { id: "invest_below", label: "Investimento fora pra baixo (maior diferença)" },
];

// Quem não tem o dado necessário pra ordenação (sem meta/sem CPA) vai sempre
// pro final — nunca "ganha" posição por falta de dado.
const MISSING = Number.NEGATIVE_INFINITY;

// Pontuação de criticidade: grupo 3 = CPA alto E investimento fora (pra
// cima ou pra baixo), 2 = só um dos dois problemas, 1 = tudo ok, 0 = sem
// dado nenhum. Dentro do grupo, desempata pela soma das duas distâncias em
// % (CPA acima do ideal ÷ CPA ideal + distância do investimento ao ideal ÷
// ideal) — % pra somar R$ de CPA com R$ de investimento sem um engolir o outro.
function criticalScore(r: MetasRow): number {
  const cpaBad = r.cpaStatus === "high";
  const investBad = r.investStatus === "below" || r.investStatus === "above";
  if (r.cpaStatus == null && r.investStatus == null) return MISSING;
  const group = cpaBad && investBad ? 3 : cpaBad || investBad ? 2 : 1;
  const cpaPart = r.cpaDiff != null && r.cpaTarget ? Math.max(r.cpaDiff, 0) / r.cpaTarget : 0;
  const investPart =
    r.investDiff != null && r.idealUntilYesterday ? Math.abs(r.investDiff) / r.idealUntilYesterday : 0;
  return group * 1000 + cpaPart + investPart;
}

// Chave de ordenação (maior = vem primeiro). Pra "fora pra cima" a maior
// diferença é investido − ideal em R$ (positiva); pra "fora pra baixo" é
// ideal − investido em R$. Não filtra ninguém: quem está dentro da meta ou do
// outro lado só desce na lista.
export function metasSortKey(r: MetasRow, sort: MetasSort): number {
  switch (sort) {
    case "critical":
      return criticalScore(r);
    case "cpa":
      return r.cpaDiff ?? MISSING;
    case "invest_above":
      return r.investDiff ?? MISSING;
    case "invest_below":
      return r.investDiff != null ? -r.investDiff : MISSING;
  }
}
