export function fmtCurrency(value: number | null | undefined, currency = "BRL"): string {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

// Mesmo formato do fmtCurrency, mas sempre com o sinal + ou - na frente —
// usado nas dicas (title) de diferença, ex.: "Invest. diário − Ritmo" ou
// "CPA ideal − CPA", pra deixar claro se está acima ou abaixo sem precisar
// decorar a ordem da subtração.
export function fmtCurrencySigned(value: number | null | undefined, currency = "BRL"): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "+";
  return `${sign}${fmtCurrency(Math.abs(value), currency)}`;
}

export const DATE_PRESETS = [
  { id: "last_3d_plus_today", label: "Últimos 3 dias + hoje" },
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "last_3d", label: "Últimos 3 dias" },
  { id: "last_7d", label: "Últimos 7 dias" },
  { id: "this_month", label: "Mês atual" },
] as const;

export type PresetId = (typeof DATE_PRESETS)[number]["id"];

export const PAYMENT_TYPES = [
  { id: "prepaid", label: "Pré-paga" },
  { id: "hybrid", label: "Híbrida" },
  { id: "postpaid", label: "Pós-paga" },
  { id: "own_store", label: "Loja própria" },
] as const;

export interface PriorityOption {
  id: string;
  label: string;
  color: string;
}

// Os 5 IDs abaixo são fixos — a classificação automática (atualização de
// status em massa) e o isInauguracao() dependem deles por valor. O que dá
// pra personalizar em Configurações > Status é só o rótulo e a cor (ver
// lib/priority-context.tsx) — a lista de IDs em si nunca muda.
export const DEFAULT_PRIORITY_OPTIONS: PriorityOption[] = [
  { id: "inauguracao", label: "Inauguração", color: "#38bdf8" },
  { id: "baixa", label: "Baixa", color: "#22c55e" },
  { id: "media", label: "Média", color: "#eab308" },
  { id: "alta", label: "Alta", color: "#f97316" },
  { id: "critica", label: "Crítica", color: "#ef4444" },
];

// Mantido pelo nome antigo pra quem só precisa dos rótulos padrão (ex.: a
// classificação automática, que sempre raciocina em cima dos IDs fixos).
export const PRIORITY_OPTIONS = DEFAULT_PRIORITY_OPTIONS;

export function isInauguracao(priority: string | null | undefined): boolean {
  return priority === "inauguracao";
}
