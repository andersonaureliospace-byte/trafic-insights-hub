// Tipos e regra de recorrência dos disparos agendados — compartilhados entre
// a rota que cria/edita o agendamento e o hook público que efetivamente
// envia (chamado pelo n8n num intervalo, ex.: a cada minuto).

export interface DispatchTarget {
  ad_account_id: string;
  client_name: string;
  wa_group_id: string;
  wa_group_name: string;
}

// A regra de recorrência em si mora em lib/scheduling.ts (reaproveitada
// pelos relatórios agendados) — reexportada aqui pra não quebrar quem já
// importa esses dois símbolos deste módulo.
export { nextOccurrence, type Recurrence } from "@/lib/scheduling";

export function interpolate(message: string, clientName: string): string {
  return (message ?? "").replaceAll("{cliente}", clientName);
}
