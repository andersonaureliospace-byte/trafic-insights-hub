// Ritmo (Acompanhamento): quanto falta investir por dia, dos dias que
// restam no mês (incluindo hoje), pra bater a meta de Investimento mensal.
// Extraído pra cá (Etapa 53) — antes vivia só em app/(app)/painel/page.tsx
// — pra ser reaproveitado também pelo aviso automático de investimento
// baixo (lib/alerts/low-investment.ts), com a mesma conta exata que a tela
// usa.

// Mês sempre considerado com 30 dias, por pedido — não os 28-31 reais do
// calendário. Sem Investimento mensal cadastrado, não dá pra calcular.
export function ritmo(monthlyInvestment: number | null | undefined, spentThisMonth: number | undefined): number | null {
  if (monthlyInvestment == null) return null;
  const dayOfMonth = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", day: "numeric" }).format(new Date()),
  );
  const remainingDays = Math.max(30 - dayOfMonth + 1, 1); // hoje conta como 1 dos dias restantes
  return (monthlyInvestment - (spentThisMonth ?? 0)) / remainingDays;
}

// Compara o quanto precisa investir por dia daqui pra frente (Ritmo) com o
// orçamento diário JÁ configurado na conta — mesma banda usada pra colorir
// a coluna Ritmo e pro filtro Investimento Baixo/Alto de Acompanhamento.
// diferença dentro de ±10 = no ritmo certo; mais de R$10 ACIMA do orçamento
// diário atual = precisaria investir mais do que está configurado
// ("Investimento Baixo"); mais de R$10 ABAIXO = investindo mais rápido do
// que precisa ("Investimento Alto").
export const RITMO_BAND = 10;
