// Acompanhamento de metas (Etapa 82) — cálculo puro (sem React, sem Meta),
// modelado no dashboard de referência da Speed. O investimento e o CPA vêm do
// preset this_month_until_yesterday (dia 01 até ontem, dias já fechados). O
// IDEAL, igual à Speed ("Ideal até hoje" na dica deles), é proporcional aos
// dias do mês ATÉ HOJE (dia do mês, contando hoje): Investimento mensal ÷ dias
// do mês × dia de hoje. Conferido na Speed: dia 04 de outubro, meta R$ 3.000
// → 3.000 ÷ 31 × 4 = R$ 387,10.

import { monthCalendarSP } from "./ritmo";

// CPA: diferença (CPA − CPA ideal) até R$1,40 acima do ideal = aceitável
// (laranja); acima disso = crítico (vermelho); abaixo/igual ao ideal = verde.
// Mesma banda de cpaDiffColorClass (Acompanhamento) — e bate com a Speed
// ("Dentro do aceitável" em +R$1,32, "Acima da meta" em +R$1,62).
export const CPA_ACCEPTABLE_BAND = 1.4;

// Investimento: dentro de 80%–120% do ideal até hoje = "dentro da meta".
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
  dailyBudget: number; // orçamento diário atual (Invest. diário)
  ritmo: number | null; // quanto precisa investir por dia daqui pra frente
}

export interface MetasRow {
  invested: number;
  monthlyTarget: number | null;
  idealUntilToday: number | null; // Investimento mensal ÷ dias do mês × dia de hoje // Investimento mensal ÷ dias do mês × dia de hoje
  pctOfTarget: number | null; // investido ÷ meta mensal (0-1+)
  investDiff: number | null; // investido − ideal (R$; negativo = faltou)
  // Invest. diário − Ritmo (R$): a diferença mostrada embaixo de Invest. diário.
  // Negativa = orçamento diário abaixo do que precisa; positiva = acima.
  dailyDiff: number | null;
  investRatio: number | null; // investido ÷ ideal
  investStatus: InvestStatus | null;
  cpa: number | null;
  cpaTarget: number | null;
  cpaDiff: number | null; // CPA − CPA ideal
  cpaStatus: CpaStatus | null;
}

// Dia de hoje (dias do mês decorridos, contando hoje) e dias reais do mês — mesma
// base do Ritmo (monthCalendarSP). untilLabel = "dd/mm" de ontem, último dia
// com dado fechado ("" no dia 01, quando ainda não há nenhum).
export function metasCalendar(now: Date = new Date()): {
  elapsedDays: number;
  daysInMonth: number;
  untilLabel: string;
} {
  const { month, day, daysInMonth } = monthCalendarSP(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { elapsedDays: day, daysInMonth, untilLabel: day > 1 ? `${pad(day - 1)}/${pad(month)}` : "" };
}

export function computeMetas(input: MetasInput, elapsedDays: number, daysInMonth: number): MetasRow {
  const { invested, monthlyTarget, cpa, cpaTarget, dailyBudget, ritmo } = input;
  const dailyDiff = ritmo != null ? dailyBudget - ritmo : null;

  const hasMonthly = monthlyTarget != null && monthlyTarget > 0;
  const idealUntilToday =
    hasMonthly ? (monthlyTarget / daysInMonth) * elapsedDays : null;
  const pctOfTarget = hasMonthly ? invested / monthlyTarget : null;
  const investDiff = idealUntilToday != null ? invested - idealUntilToday : null;
  const investRatio = idealUntilToday != null && idealUntilToday > 0 ? invested / idealUntilToday : null;
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
    idealUntilToday,
    pctOfTarget,
    investDiff,
    dailyDiff,
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
  { id: "invest_above", label: "Investimento fora pra cima (Invest. diário acima do Ritmo)" },
  { id: "invest_below", label: "Investimento fora pra baixo (Invest. diário abaixo do Ritmo)" },
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
    r.investDiff != null && r.idealUntilToday ? Math.abs(r.investDiff) / r.idealUntilToday : 0;
  return group * 1000 + cpaPart + investPart;
}

// Chave de ordenação (maior = vem primeiro). "Investimento fora" aqui é a
// diferença Invest. diário − Ritmo (a mesma mostrada embaixo de Invest.
// diário): pra "fora pra cima" a maior diferença positiva (orçamento diário
// acima do que precisa) vem primeiro; pra "fora pra baixo" a mais negativa
// (orçamento diário abaixo do que precisa). Não filtra ninguém: quem está do
// outro lado só desce na lista.
export function metasSortKey(r: MetasRow, sort: MetasSort): number {
  switch (sort) {
    case "critical":
      return criticalScore(r);
    case "cpa":
      return r.cpaDiff ?? MISSING;
    case "invest_above":
      return r.dailyDiff ?? MISSING;
    case "invest_below":
      return r.dailyDiff != null ? -r.dailyDiff : MISSING;
  }
}
