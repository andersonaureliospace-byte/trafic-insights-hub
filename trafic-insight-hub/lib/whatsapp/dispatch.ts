// Tipos e regra de recorrência dos disparos agendados — compartilhados entre
// a rota que cria/edita o agendamento e o hook público que efetivamente
// envia (chamado pelo n8n num intervalo, ex.: a cada minuto).

export interface DispatchTarget {
  ad_account_id: string;
  client_name: string;
  // Etapa 73: destino de um disparo de PIX pode ser um número de WhatsApp
  // direto, não só grupo — quando é número, wa_group_id carrega esse número
  // (o campo genérico que o client de WhatsApp já usa como "number" pra
  // ambos os casos, ver lib/whatsapp/client.ts) e wa_group_name fica vazio.
  wa_group_id: string;
  wa_group_name: string;
}

// Re-exportado aqui só pra quem importa tipos de disparo por este módulo
// não precisar saber que "partes" mora em pix-message.ts.
export type { PixMessagePart } from "@/lib/whatsapp/pix-message";

// A regra de recorrência em si mora em lib/scheduling.ts (reaproveitada
// pelos relatórios agendados) — reexportada aqui pra não quebrar quem já
// importa esses dois símbolos deste módulo.
export { nextOccurrence, type Recurrence } from "@/lib/scheduling";

export function interpolate(message: string, clientName: string): string {
  return (message ?? "").replaceAll("{cliente}", clientName);
}
