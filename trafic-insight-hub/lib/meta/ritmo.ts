// Ritmo (Acompanhamento): quanto investir por dia, a partir de hoje, pra
// acompanhar o ideal da meta de Investimento mensal. Extraído pra cá (Etapa 53) — antes vivia só em app/(app)/painel/page.tsx
// — pra ser reaproveitado também pelo aviso automático de investimento
// baixo (lib/alerts/low-investment.ts), com a mesma conta exata que a tela
// usa.

// Etapa 82: calendário do mês corrente no fuso de Brasília — dia de hoje e
// quantos dias o mês tem DE VERDADE (28-31). Antes o Ritmo fixava o mês em 30
// dias; o dashboard de referência (Speed) usa os dias reais (31 em outubro:
// R$ 5.095 ÷ 31 × 4 dias fechados = R$ 657,42, confere em todas as contas
// conferidas), então o Ritmo passou a usar a mesma base pra não divergir.
// Compartilhado com a aba Acompanhamento de metas (lib/meta/metas.ts).
export function monthCalendarSP(now: Date = new Date()): { year: number; month: number; day: number; daysInMonth: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month"); // 1-12
  const day = get("day");
  // Dia 0 do mês seguinte = último dia do mês atual.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day, daysInMonth };
}

// Etapa 85: o Ritmo deixou de ser "(meta − gasto) ÷ dias restantes" e virou um
// ritmo de ALCANCE do ideal: o investimento diário normal (Investimento mensal
// ÷ dias do mês) mais/menos a diferença pro "Ideal até hoje" (mesmo da aba
// Acompanhamento de metas: normal × dia de hoje), com o ajuste limitado a ±50%
// do normal. Ex.: meta 3.000 em mês de 30 dias → normal 100; dia 5, ideal 500,
// gasto até ontem 300 → falta 200 → ajuste de +50 (teto) → Ritmo 150, e daria
// 150, 150, 150, 150, 100 nos dias seguintes até zerar a diferença (com falta de
// 115: 150, 150, 115, 100). Adiantado (gasto acima do ideal) desacelera na
// mesma proporção, até −50% do normal (nunca abaixo de zero).
// `spentUntilYesterday` = gasto do dia 01 até ONTEM (dias fechados) — compara
// com o ideal que já conta hoje, igual à Speed. No dia 01 não há dia fechado,
// então o gasto considerado é 0. Sem Investimento mensal, não dá pra calcular.
export const RITMO_MAX_ADJUST = 0.5;
export function ritmo(
  monthlyInvestment: number | null | undefined,
  spentUntilYesterday: number | undefined,
  now: Date = new Date(),
): number | null {
  if (monthlyInvestment == null) return null;
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const idealUntilToday = normal * day;
  const spent = day === 1 ? 0 : (spentUntilYesterday ?? 0);
  const gap = idealUntilToday - spent; // positivo = atrasado; negativo = adiantado
  const cap = normal * RITMO_MAX_ADJUST;
  return normal + Math.max(-cap, Math.min(gap, cap));
}

// Compara o quanto precisa investir por dia daqui pra frente (Ritmo) com o
// orçamento diário JÁ configurado na conta — mesma banda usada pra colorir
// a coluna Ritmo e pro filtro Investimento Baixo/Alto de Acompanhamento.
// diferença dentro de ±10 = no ritmo certo; mais de R$10 ACIMA do orçamento
// diário atual = precisaria investir mais do que está configurado
// ("Investimento Baixo"); mais de R$10 ABAIXO = investindo mais rápido do
// que precisa ("Investimento Alto").
export const RITMO_BAND = 10;

// Cor da diferença mostrada embaixo de "Invest. diário" (Acompanhamento e,
// desde a Etapa 82, Acompanhamento de metas). Compara o quanto precisa
// investir por dia daqui pra frente (Ritmo) com o orçamento diário JÁ
// configurado na conta (orçamento atual dos conjuntos/campanhas ativos, não
// muda com o período escolhido).
// - diferença dentro de ±10: orçamento diário já está no ritmo certo → verde
// - Ritmo mais de 10 reais ACIMA do orçamento diário atual: precisaria
//   investir mais do que está configurado → laranja
// - Ritmo mais de 10 reais ABAIXO do orçamento diário atual: o orçamento
//   atual está investindo mais rápido do que precisa → vermelho
export function ritmoColorClass(rowRitmo: number | null, dailyBudget: number | undefined): string {
  if (rowRitmo == null) return "";
  const diff = rowRitmo - (dailyBudget ?? 0);
  if (diff > RITMO_BAND) return "text-orange-600 dark:text-orange-400";
  if (diff < -RITMO_BAND) return "text-red-600 dark:text-red-400";
  return "text-emerald-600 dark:text-emerald-400";
}
