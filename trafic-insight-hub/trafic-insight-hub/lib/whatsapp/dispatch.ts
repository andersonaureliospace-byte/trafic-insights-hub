// Tipos e regra de recorrência dos disparos agendados — compartilhados entre
// a rota que cria/edita o agendamento e o hook público que efetivamente
// envia (chamado pelo n8n num intervalo, ex.: a cada minuto).

export interface DispatchTarget {
  ad_account_id: string;
  client_name: string;
  wa_group_id: string;
  wa_group_name: string;
}

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

export function interpolate(message: string, clientName: string): string {
  return (message ?? "").replaceAll("{cliente}", clientName);
}
