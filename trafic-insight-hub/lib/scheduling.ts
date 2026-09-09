// Regra genérica de recorrência (soma o intervalo à última ocorrência,
// preservando o dia da semana/mês escolhido na primeira vez) — extraída de
// lib/whatsapp/dispatch.ts pra ser reaproveitada também pelos relatórios
// agendados. lib/whatsapp/dispatch.ts reexporta os dois símbolos abaixo
// pra não quebrar quem já importava de lá.

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  if (recurrence === "none") return null;
  const next = new Date(from);
  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  return null;
}
