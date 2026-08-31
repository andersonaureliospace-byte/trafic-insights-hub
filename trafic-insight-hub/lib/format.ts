export function fmtCurrency(value: number | null | undefined, currency = "BRL"): string {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export const DATE_PRESETS = [
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
] as const;

export const PRIORITY_OPTIONS = [
  { id: "baixa", label: "Baixa", color: "#22c55e" },
  { id: "media", label: "Média", color: "#eab308" },
  { id: "alta", label: "Alta", color: "#f97316" },
  { id: "critica", label: "Crítica", color: "#ef4444" },
] as const;
