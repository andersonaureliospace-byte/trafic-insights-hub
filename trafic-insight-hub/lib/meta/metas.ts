// Acompanhamento de metas (Etapa 82) — cálculo puro (sem React, sem Meta),
// modelado no dashboard de referência da Speed. O investimento e o CPA vêm do
// preset this_month (dia 01 até agora, contando hoje — Etapa 92). O
// IDEAL, igual à Speed ("Ideal até hoje" na dica deles), é proporcional aos
// dias do mês ATÉ HOJE (dia do mês, contando hoje): Investimento mensal ÷ dias
// do mês × dia de hoje. Conferido na Speed: dia 04 de outubro, meta R$ 3.000
// → 3.000 ÷ 31 × 4 = R$ 387,10.

import { monthCalendarSP, INVEST_TOLERANCE } from "./ritmo";

// CPA: diferença (CPA − CPA ideal) até R$2,50 acima do ideal = atenção
// (amarelo/laranja); acima disso = crítico (vermelho); abaixo/igual ao ideal =
// verde. Etapa 93/94: R$2,50, a pedido — mesma banda de Acompanhamento.
export const CPA_ACCEPTABLE_BAND = 2.5;

// Investimento (Etapa 102): tolerância de 2 pontos da META MENSAL pros dois lados
// do ideal até hoje. Mais de 2 pontos ATRÁS = "abaixo" (laranja); mais de 2 pontos
// ACIMA = "acima" (vermelho); entre os dois = dentro da meta (verde). Ex.: ideal 38%,
// investido 33% → laranja; investido 41% → vermelho; 37,8% → verde.
// Investido = dia 01 até agora (com o gasto de hoje).

export type InvestStatus = "below" | "ok" | "above";
export type CpaStatus = "good" | "acceptable" | "high";

export interface MetasInput {
  invested: number; // gasto do dia 01 até agora (com hoje)
  monthlyTarget: number | null; // Investimento mensal cadastrado
  cpa: number | null; // CPA do dia 01 até agora (com hoje)
  cpaTarget: number | null; // CPA ideal cadastrado
  dailyBudget?: number; // orçamento diário atual (Invest. diário) — só Desempenho usa
  ritmo?: number | null; // quanto precisa investir por dia daqui pra frente — só Desempenho usa
}

export interface MetasRow {
  invested: number;
  monthlyTarget: number | null;
  idealUntilToday: number | null; // Investimento mensal ÷ dias do mês × dia de hoje // Investimento mensal ÷ dias do mês × dia de hoje
  pctOfTarget: number | null; // investido ÷ meta mensal (0-1+)
  investDiff: number | null; // investido − ideal (R$; negativo = faltou)
  // (investido − ideal) ÷ meta mensal: diferença em "pontos" da meta do mês (ex.: 0,07 = 7 pontos
  // acima; negativo = atrás). Base mensal, comparável entre clientes de tamanhos diferentes.
  investGap: number | null;
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
  const dailyDiff = ritmo != null && dailyBudget != null ? dailyBudget - ritmo : null;

  const hasMonthly = monthlyTarget != null && monthlyTarget > 0;
  const idealUntilToday =
    hasMonthly ? (monthlyTarget / daysInMonth) * elapsedDays : null;
  const pctOfTarget = hasMonthly ? invested / monthlyTarget : null;
  const investDiff = idealUntilToday != null ? invested - idealUntilToday : null;
  const investGap = hasMonthly && investDiff != null ? investDiff / monthlyTarget : null;
  const investRatio = idealUntilToday != null && idealUntilToday > 0 ? invested / idealUntilToday : null;
  let investStatus: InvestStatus | null = null;
  if (investRatio != null) {
    const diffPoints = hasMonthly && idealUntilToday != null ? (invested - idealUntilToday) / monthlyTarget : 0;
    investStatus = diffPoints < -INVEST_TOLERANCE ? "below" : diffPoints > INVEST_TOLERANCE ? "above" : "ok";
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
    investGap,
    dailyDiff,
    investRatio,
    investStatus,
    cpa,
    cpaTarget,
    cpaDiff,
    cpaStatus,
  };
}

export type MetasSort = "critical" | "cpa" | "invest" | "invest_above" | "invest_below";

// Opções da aba Metas (a de Desempenho continua usando METAS_SORTS, com Invest. diário × Ritmo).
// Tudo na base MENSAL: investimento = diferença entre o investido e o ideal até hoje, em % da meta
// do mês (pra cima ou pra baixo, só importa o tamanho); CPA = quanto está acima do CPA ideal.
export const METAS_TAB_SORTS: { id: MetasSort; label: string }[] = [
  { id: "critical", label: "Padrão (mais fora da meta → mais tranquilas)" },
  { id: "invest", label: "Investimento (maior diferença → menor)" },
  { id: "cpa", label: "CPA (maior diferença acima da meta → menor)" },
];

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
  const investPart = r.investGap != null ? Math.abs(r.investGap) : 0;
  return group * 1000 + cpaPart + investPart;
}

// Chave de ordenação (maior = vem primeiro). "Investimento fora" aqui é a
// diferença Invest. diário − Ritmo (a mesma mostrada embaixo de Invest.
// diário): pra "fora pra cima" a maior diferença positiva (orçamento diário
// acima do que precisa) vem primeiro; pra "fora pra baixo" a mais negativa
// (orçamento diário abaixo do que precisa). Não filtra ninguém: quem está do
// outro lado só desce na lista.
// Comparador "maior primeiro" seguro com -Infinity (sem dado): dois -Infinity
// dão empate (0) em vez de NaN, que deixaria a ordenação inconsistente.
export function compareMetas(a: MetasRow, b: MetasRow, sort: MetasSort): number {
  const ka = metasSortKey(a, sort);
  const kb = metasSortKey(b, sort);
  if (ka === kb) return 0;
  return kb > ka ? 1 : -1;
}

export function metasSortKey(r: MetasRow, sort: MetasSort): number {
  switch (sort) {
    case "critical":
      return criticalScore(r);
    case "cpa":
      return r.cpaDiff ?? MISSING;
    case "invest":
      return r.investGap != null ? Math.abs(r.investGap) : MISSING;
    case "invest_above":
      return r.dailyDiff ?? MISSING;
    case "invest_below":
      return r.dailyDiff != null ? -r.dailyDiff : MISSING;
  }
}
