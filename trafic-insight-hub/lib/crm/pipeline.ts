// Pipeline fixo do CRM — o app antigo permitia customizar colunas, mas pra
// manter o escopo simples (e já que é uso interno, não multi-cliente) o
// funil fica com esses 6 estágios fixos.

export const LEAD_STATUSES = [
  { id: "novo", label: "Novo" },
  { id: "contato", label: "Em contato" },
  { id: "qualificado", label: "Qualificado" },
  { id: "proposta", label: "Proposta" },
  { id: "venda", label: "Venda" },
  { id: "perdido", label: "Perdido" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["id"];

export const LEAD_STATUS_IDS = LEAD_STATUSES.map((s) => s.id) as LeadStatus[];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUS_IDS as string[]).includes(value);
}

export function leadStatusLabel(status: string): string {
  return LEAD_STATUSES.find((s) => s.id === status)?.label ?? status;
}
