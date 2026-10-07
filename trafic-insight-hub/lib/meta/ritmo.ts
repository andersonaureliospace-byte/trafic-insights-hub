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

// Etapa 85/91: Ritmo de ALCANCE do ideal. Base = investimento diário normal
// (Investimento mensal ÷ dias do mês). Ideal até hoje = normal × dia de hoje (mesmo
// da aba Acompanhamento de metas). `spentSoFar` = gasto do dia 01 ATÉ AGORA, contando
// o que já foi gasto hoje (o mesmo "Valor usado" de "Mês atual").
// - Dentro da faixa de 80%–120% do ideal ("dentro da meta"): Ritmo = normal, sem ajuste.
// - Atrasado (abaixo de 80%): acelera = normal + diferença pro ideal, limitada a +50%
//   do normal. Ex.: meta 3.000 em mês de 30 dias → normal 100; dia 5, ideal 500,
//   gasto 300 → falta 200 → ajuste de +50 (teto) → Ritmo 150 (e 150, 150, 150, 150, 100
//   nos dias seguintes até a diferença zerar).
// - Adiantado (acima de 120%): desacelera na mesma proporção, até −50% do normal.
// (Etapa 91: antes usava o gasto só até ontem e não tinha faixa — uma conta que
// já tinha gasto bastante hoje aparecia como atrasada e com Ritmo no teto.)
// Sem Investimento mensal, não dá pra calcular.
export const RITMO_MAX_ADJUST = 0.5;
// Mesma faixa de "dentro da meta" de lib/meta/metas.ts (INVEST_LOW_RATIO/HIGH_RATIO).
export const RITMO_OK_LOW = 0.8;
export const RITMO_OK_HIGH = 1.2;
export function ritmo(
  monthlyInvestment: number | null | undefined,
  spentSoFar: number | undefined,
  now: Date = new Date(),
): number | null {
  if (monthlyInvestment == null) return null;
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const idealUntilToday = normal * day;
  const spent = spentSoFar ?? 0;
  if (idealUntilToday > 0) {
    const ratio = spent / idealUntilToday;
    if (ratio >= RITMO_OK_LOW && ratio <= RITMO_OK_HIGH) return normal;
  }
  const gap = idealUntilToday - spent; // positivo = atrasado; negativo = adiantado
  const cap = normal * RITMO_MAX_ADJUST;
  return normal + Math.max(-cap, Math.min(gap, cap));
}

// Etapa 89: Ritmo a partir do insight do mês (até agora, com hoje) da conta. Se o insight
// não chegou ou a busca falhou, NÃO assume gasto zero (isso inflava o Ritmo pro
// teto de +50%, ex.: R$ 145 numa conta que estava na meta) — devolve null.
export function ritmoFromInsight(
  monthlyInvestment: number | null | undefined,
  insight: { spend: number; insights_failed?: boolean } | undefined,
  now: Date = new Date(),
): number | null {
  if (!insight || insight.insights_failed) return null;
  return ritmo(monthlyInvestment, insight.spend, now);
}

// Etapa 90: texto da dica da coluna Ritmo — mostra os números que entraram na conta
// (pra conferir de onde veio o valor sem precisar adivinhar).
export function ritmoTooltip(
  monthlyInvestment: number | null | undefined,
  insight: { spend: number; insights_failed?: boolean } | undefined,
  now: Date = new Date(),
): string {
  const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  if (monthlyInvestment == null) return "Sem Investimento mensal cadastrado — não dá pra calcular o Ritmo.";
  if (!insight) return "Gasto do mês ainda não carregado — clique em Atualizar.";
  if (insight.insights_failed) return "A Meta não devolveu o gasto do mês desta conta — clique em Atualizar pra tentar de novo.";
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const ideal = normal * day;
  const spent = insight.spend;
  const r = ritmo(monthlyInvestment, insight.spend, now) ?? 0;
  const ratio = ideal > 0 ? spent / ideal : 0;
  const faixa =
    ratio >= RITMO_OK_LOW && ratio <= RITMO_OK_HIGH
      ? `Dentro da meta (${Math.round(ratio * 100)}% do ideal, faixa 80%–120%) → Ritmo = normal`
      : `Fora da faixa (${Math.round(ratio * 100)}% do ideal) → diferença ${brl(ideal - spent)}, ajuste limitado a ±${brl(normal * RITMO_MAX_ADJUST)}`;
  return (
    `Investimento mensal: ${brl(monthlyInvestment)} ÷ ${daysInMonth} dias = ${brl(normal)} por dia\n` +
    `Ideal até hoje (dia ${day}): ${brl(ideal)}\n` +
    `Gasto de 01 até agora (com hoje): ${brl(spent)}\n` +
    `${faixa}\n` +
    `Ritmo: ${brl(r)}`
  );
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
