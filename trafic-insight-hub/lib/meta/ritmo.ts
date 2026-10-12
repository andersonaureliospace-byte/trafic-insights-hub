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

// Etapa 85/91/101: Ritmo de ALCANCE do ideal. Base = investimento diário normal
// (Investimento mensal ÷ dias do mês). Ideal até hoje = normal × dia de hoje (mesmo
// da aba Acompanhamento de metas). `spentSoFar` = gasto do dia 01 ATÉ AGORA, contando
// o que já foi gasto hoje (o mesmo "Valor usado" de "Mês atual").
// Etapa 101 (regra nova, a pedido): a tolerância de atraso é de 3 pontos da META
// MENSAL (ex.: ideal 38% e investido 33% = 5 pontos atrás). Passou disso, o Ritmo
// DOBRA (2× o normal) até a conta alcançar o ideal. Ex.: meta 4.400 (normal 141,94),
// 250,87 atrás → Ritmo 283,88 por 2 dias seguidos.
// - Atrasado até 3 pontos da meta (ou em dia, até 120% do ideal): Ritmo = normal.
// - Atrasado mais de 3 pontos: Ritmo = 2× o normal.
// - Adiantado (acima de 120% do ideal): desacelera na mesma proporção da diferença,
//   até −50% do normal.
// Sem Investimento mensal, não dá pra calcular.
export const RITMO_MAX_ADJUST = 0.5;
// Etapa 101: tolerância de atraso, em fração da meta mensal (0,03 = 3 pontos).
export const RITMO_BEHIND_TOLERANCE = 0.03;
// Etapa 101: quanto o Ritmo multiplica o normal quando a conta está atrasada além da tolerância.
export const RITMO_CATCHUP_MULTIPLIER = 2;
export const RITMO_OK_HIGH = 1.2;

// Atraso da conta em relação ao ideal até hoje (R$, positivo = atrasado) e se
// ele passou da tolerância de 3 pontos da meta mensal.
export function ritmoGap(
  monthlyInvestment: number,
  spentSoFar: number,
  now: Date = new Date(),
): { normal: number; ideal: number; gap: number; behindPoints: number; catchingUp: boolean; daysToCatchUp: number } {
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const ideal = normal * day;
  const gap = ideal - spentSoFar;
  const behindPoints = monthlyInvestment > 0 ? gap / monthlyInvestment : 0;
  const catchingUp = monthlyInvestment > 0 && behindPoints > RITMO_BEHIND_TOLERANCE;
  // Quantos dias no dobro até zerar o atraso: cada dia no dobro recupera 1× o normal.
  const daysToCatchUp = catchingUp && normal > 0 ? Math.ceil(gap / normal) : 0;
  return { normal, ideal, gap, behindPoints, catchingUp, daysToCatchUp };
}

export function ritmo(
  monthlyInvestment: number | null | undefined,
  spentSoFar: number | undefined,
  now: Date = new Date(),
): number | null {
  if (monthlyInvestment == null) return null;
  const { normal, ideal, gap, catchingUp } = ritmoGap(monthlyInvestment, spentSoFar ?? 0, now);
  if (catchingUp) return normal * RITMO_CATCHUP_MULTIPLIER;
  if (gap >= 0) return normal; // atrasado dentro da tolerância
  if (ideal > 0 && (spentSoFar ?? 0) / ideal <= RITMO_OK_HIGH) return normal; // em dia
  const cap = normal * RITMO_MAX_ADJUST;
  return normal + Math.max(-cap, gap); // adiantado demais: desacelera
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
  const spent = insight.spend;
  const g = ritmoGap(monthlyInvestment, spent, now);
  const r = ritmo(monthlyInvestment, spent, now) ?? 0;
  const pts = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
  const faixa = g.catchingUp
    ? `Atrasado ${brl(g.gap)} (${pts(g.behindPoints)} da meta, tolerância 3%) → dobrar o investimento: Ritmo = 2× o normal, por ${g.daysToCatchUp} dia(s) seguidos até igualar o ideal`
    : g.gap >= 0
      ? `Atrasado ${brl(g.gap)} (${pts(g.behindPoints)} da meta) — dentro da tolerância de 3% → Ritmo = normal`
      : spent / g.ideal <= RITMO_OK_HIGH
        ? `Em dia (${Math.round((spent / g.ideal) * 100)}% do ideal) → Ritmo = normal`
        : `Adiantado (${Math.round((spent / g.ideal) * 100)}% do ideal) → diferença ${brl(spent - g.ideal)}, ajuste limitado a ±${brl(g.normal * RITMO_MAX_ADJUST)}`;
  return (
    `Investimento mensal: ${brl(monthlyInvestment)} ÷ ${daysInMonth} dias = ${brl(g.normal)} por dia\n` +
    `Ideal até hoje (dia ${day}): ${brl(g.ideal)}\n` +
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
