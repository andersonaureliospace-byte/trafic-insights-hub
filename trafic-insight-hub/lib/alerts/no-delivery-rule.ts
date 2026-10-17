// Regra pura do alerta "conta sem anúncio ativo / sem entrega" (Etapa 138).
// - "sem anúncio ativo": a conta não tem NENHUM anúncio realmente ativo (nada pode gastar). Vale a qualquer hora do dia.
// - "sem entrega": tem anúncio ativo, mas nenhum gasto/impressão hoje depois das 10h (BRT) — algo travou
//   (aprovação, saldo, público, limite…). Antes das 10h ainda é cedo pra concluir.

export const NO_DELIVERY_FROM_HOUR = 10; // a partir daqui, zero gasto hoje vira "sem entrega"
export const WATCH_FROM_HOUR = 8; // o hook só olha entre 8h e 21h (BRT)
export const WATCH_UNTIL_HOUR = 21;

export type DeliveryProblem = "no-active-ad" | "no-delivery";

export function hourBrt(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now),
  ) % 24;
}

export function isWatchHour(hour: number): boolean {
  return hour >= WATCH_FROM_HOUR && hour < WATCH_UNTIL_HOUR;
}

export function classifyDelivery(input: {
  activeAds: number;
  spendToday: number;
  impressionsToday: number;
  hour: number;
}): DeliveryProblem | null {
  if (input.activeAds <= 0) return "no-active-ad";
  if (input.hour >= NO_DELIVERY_FROM_HOUR && input.spendToday <= 0 && input.impressionsToday <= 0) return "no-delivery";
  return null;
}

export const PROBLEM_TEXT: Record<DeliveryProblem, string> = {
  "no-active-ad": "sem anúncio ativo",
  "no-delivery": "anúncios ativos, mas sem entrega hoje",
};

export function formatNoDeliveryLine(name: string, problem: DeliveryProblem): string {
  return `• ${name} — ${PROBLEM_TEXT[problem]}`;
}
