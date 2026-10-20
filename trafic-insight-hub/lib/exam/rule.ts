// Contas que precisam de EXAME (Etapa 163) — regras puras (sem Meta/banco), testáveis.
import { parseAdsetName } from "@/lib/offers/rule";

// Conjunto de EXAME = o nome começa com EXAME (padrão TIPO | OFERTA | …). Conjunto de boleto/crediário não conta
// (na planilha do usuário ele é outro tipo, mesmo que o nome comece com EXAME).
export function isExamAdsetName(name: string): boolean {
  const p = parseAdsetName(name);
  return !!p && p.type === "EXAME" && !p.payment;
}

export function isIvsName(clientName: string): boolean {
  return /\bIVS\b/i.test(clientName);
}

// Precisa de exame? A escolha manual (true/false) vale; sem escolha (null), as contas IVS precisam e as outras não.
export function examRequired(explicit: boolean | null | undefined, clientName: string): boolean {
  return explicit ?? isIvsName(clientName);
}

export function formatExamLine(clientName: string): string {
  return `${clientName} — sem conjunto de EXAME ativo`;
}
