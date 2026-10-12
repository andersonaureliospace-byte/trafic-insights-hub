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

// Etapa 85/91/101/102: Ritmo de ALCANCE do ideal. Base = investimento diário normal
// (Investimento mensal ÷ dias do mês). Ideal até hoje = normal × dia de hoje (mesmo
// da aba Acompanhamento de metas). `spentSoFar` = gasto do dia 01 ATÉ AGORA, contando
// o que já foi gasto hoje (o mesmo "Valor usado" de "Mês atual").
// Etapa 102 (regra do Anderson): Ritmo = quanto ainda falta investir pra IGUALAR o
// ideal até hoje (ideal − investido), no mínimo 50% e no máximo 2× o normal.
//   Ex.: normal 100, dia 12, ideal 1.200, investido 1.050 → Ritmo 150.
//   Ex.: ideal 1.200/1.300/1.400 e investido 950/1.150/1.300 → Ritmo 200 (teto 2×)/150/100.
//   Ex.: já 100 acima do ideal, normal 96,77 → Ritmo 48,39 (piso 50%) até regularizar.
// A cor do Investimento (barra/valor) usa a tolerância de 2 pontos da meta mensal:
// mais de 2 pontos ATRÁS = laranja; mais de 2 pontos ACIMA do ideal = vermelho.
// Sem Investimento mensal, não dá pra calcular.
export const RITMO_MAX_MULT = 2; // teto: no máximo 2× o investimento diário normal
export const RITMO_MIN_MULT = 0.5; // piso: no mínimo 50% do normal (quando já está adiantado)
// Etapa 102: tolerância do Investimento, em fração da meta mensal (0,02 = 2 pontos),
// pros dois lados (atrás = laranja, acima = vermelho).
export const INVEST_TOLERANCE = 0.02;

export function ritmoParts(
  monthlyInvestment: number,
  spentSoFar: number,
  now: Date = new Date(),
): { normal: number; ideal: number; gap: number; behindPoints: number; ritmo: number } {
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const ideal = normal * day;
  const gap = ideal - spentSoFar; // positivo = atrasado; negativo = adiantado
  const behindPoints = monthlyInvestment > 0 ? gap / monthlyInvestment : 0;
  const r = Math.max(normal * RITMO_MIN_MULT, Math.min(gap, normal * RITMO_MAX_MULT));
  return { normal, ideal, gap, behindPoints, ritmo: r };
}

export function ritmo(
  monthlyInvestment: number | null | undefined,
  spentSoFar: number | undefined,
  now: Date = new Date(),
): number | null {
  if (monthlyInvestment == null) return null;
  return ritmoParts(monthlyInvestment, spentSoFar ?? 0, now).ritmo;
}

// Quantos dias seguidos o Ritmo fica acima do normal até a conta igualar o ideal.
// Cada dia acelerado investe o Ritmo do dia e o ideal sobe 1× o normal, então o
// atraso do dia seguinte = atraso de hoje − Ritmo de hoje + normal.
export function ritmoAcceleratedDays(
  monthlyInvestment: number,
  spentSoFar: number,
  now: Date = new Date(),
): number {
  const { normal, gap } = ritmoParts(monthlyInvestment, spentSoFar, now);
  if (!(normal > 0)) return 0;
  let g = gap;
  let days = 0;
  while (days < 31) {
    const r = Math.max(normal * RITMO_MIN_MULT, Math.min(g, normal * RITMO_MAX_MULT));
    if (r <= normal + 0.005) break;
    days += 1;
    g = g - r + normal;
  }
  return days;
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
  const g = ritmoParts(monthlyInvestment, spent, now);
  const pts = (n: number) => `${(Math.abs(n) * 100).toFixed(1).replace(".", ",")}%`;
  let faixa: string;
  if (g.gap > 0) {
    const d = ritmoAcceleratedDays(monthlyInvestment, spent, now);
    faixa =
      `Faltam ${brl(g.gap)} pro ideal (${pts(g.behindPoints)} da meta${g.behindPoints > INVEST_TOLERANCE ? ", acima da tolerância de 2%" : ", dentro da tolerância de 2%"}) → ` +
      `Ritmo = o que falta, entre ${brl(g.normal * RITMO_MIN_MULT)} (50%) e ${brl(g.normal * RITMO_MAX_MULT)} (2×)` +
      (d > 0 ? `; acelerado por ${d} dia(s)` : "");
  } else {
    faixa = `Já ${brl(-g.gap)} acima do ideal (${pts(g.behindPoints)} da meta) → Ritmo no piso de 50% do normal até regularizar`;
  }
  return (
    `Investimento mensal: ${brl(monthlyInvestment)} ÷ ${daysInMonth} dias = ${brl(g.normal)} por dia\n` +
    `Ideal até hoje (dia ${day}): ${brl(g.ideal)}\n` +
    `Gasto de 01 até agora (com hoje): ${brl(spent)}\n` +
    `${faixa}\n` +
    `Ritmo: ${brl(g.ritmo)}`
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
