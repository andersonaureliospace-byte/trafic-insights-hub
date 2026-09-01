import type { AdAccount } from "./insights";

// "Fundo disponível" de uma conta — não é o campo bruto `balance` do Graph
// API, que na verdade é "valor a pagar" (o que já acumulou desde a última
// fatura/reset), não o saldo que ainda resta pra gastar. Numa conta
// pré-paga/recarregada, "recarregar" no Meta é subir o teto de gasto
// (spend_cap) — então o fundo disponível de verdade é
// teto de gasto − já gasto (amount_spent). Quando não há teto definido
// (spend_cap = 0, típico de conta pós-paga/crédito sem limite), não existe
// "fundo" pra calcular — nesse caso cai de volta pro `balance` bruto, que aí
// sim faz sentido: é o valor que vai ser cobrado.
export function availableFunds(acc: AdAccount): { amount: number; fromCap: boolean } {
  const cap = acc.spend_cap != null ? Number(acc.spend_cap) / 100 : 0;
  if (cap > 0) {
    const spent = Number(acc.amount_spent) / 100;
    return { amount: cap - spent, fromCap: true };
  }
  return { amount: Number(acc.balance) / 100, fromCap: false };
}
