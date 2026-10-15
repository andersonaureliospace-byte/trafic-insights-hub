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

// Etapa 129 (regra do Anderson): Ritmo = o que FALTA investir ÷ quantos dias FALTAM.
//   Ritmo = (Investimento mensal − gasto do dia 01 até agora, com hoje) ÷ (dias do mês − dia de hoje)
// Conta simples de conferir: meta 5.000, já investiu 2.500 na metade do mês (dia 15 de 31 → faltam 16 dias)
// → 2.500 ÷ 16 ≈ 156 por dia. Quem está atrasado precisa de um Ritmo maior que o normal; quem está
// adiantado, menor. Sem piso de 50% do normal (esse piso fazia o Ritmo parar em R$ 80 quando a conta estava
// adiantada, mas ainda faltava investir bastante) e sem teto. Nunca fica negativo (meta já batida = 0).
//   `spentSoFar` = gasto do dia 01 ATÉ AGORA, contando o que já foi gasto hoje (o mesmo "Valor usado" de "Mês atual").
//   Último dia do mês: não sobra "amanhã", então o Ritmo é simplesmente o que falta pra meta.
// (Antes, Etapas 85/91/101/102/103/117: normal + o que falta pra alcançar o ideal de amanhã, com piso de 50%.)
// A coluna "Ideal até hoje" e as cores do Investimento continuam sempre pelo ideal DE HOJE (normal × dia).
// A cor do Investimento (barra/valor) usa a tolerância de 2 pontos da meta mensal:
// mais de 2 pontos ATRÁS = laranja; mais de 2 pontos ACIMA do ideal = vermelho.
// Sem Investimento mensal, não dá pra calcular.
// Etapa 102: tolerância do Investimento, em fração da meta mensal (0,02 = 2 pontos),
// pros dois lados (atrás = laranja, acima = vermelho).
export const INVEST_TOLERANCE = 0.02;

// Hora cheia (0-23) em Brasília.
export function hourSP(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

export interface RitmoParts {
  normal: number;
  ideal: number; // ideal até HOJE (sempre o de hoje)
  gap: number; // ideal de hoje − investido (positivo = atrasado)
  behindPoints: number; // gap ÷ meta mensal (cor/tolerância)
  remaining: number; // quanto falta pra meta do mês (nunca negativo)
  daysLeft: number; // dias que faltam depois de hoje (no último dia do mês = 0)
  ritmo: number;
}

export function ritmoParts(monthlyInvestment: number, spentSoFar: number, now: Date = new Date()): RitmoParts {
  const { day, daysInMonth } = monthCalendarSP(now);
  const normal = monthlyInvestment / daysInMonth;
  const ideal = normal * day;
  const gap = ideal - spentSoFar; // positivo = atrasado; negativo = adiantado
  const behindPoints = monthlyInvestment > 0 ? gap / monthlyInvestment : 0;
  const remaining = Math.max(0, monthlyInvestment - spentSoFar);
  const daysLeft = Math.max(0, daysInMonth - day);
  const r = daysLeft > 0 ? remaining / daysLeft : remaining;
  return { normal, ideal, gap, behindPoints, remaining, daysLeft, ritmo: r };
}

export function ritmo(
  monthlyInvestment: number | null | undefined,
  spentSoFar: number | undefined,
  now: Date = new Date(),
): number | null {
  if (monthlyInvestment == null) return null;
  return ritmoParts(monthlyInvestment, spentSoFar ?? 0, now).ritmo;
}

// Devolve 1 enquanto o Ritmo está acima do investimento normal do dia (conta atrasada, precisa acelerar) e 0 nos demais casos.
// Mantida com o mesmo nome/assinatura porque a aba Acompanhamento de metas usa o "acelerar · N dia(s)".
export function ritmoAcceleratedDays(
  monthlyInvestment: number,
  spentSoFar: number,
  now: Date = new Date(),
): number {
  const { normal, ritmo: r } = ritmoParts(monthlyInvestment, spentSoFar, now);
  if (!(normal > 0)) return 0;
  return r > normal + 0.005 ? 1 : 0;
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
  const situacao =
    g.gap > 0
      ? `Atrasado ${brl(g.gap)} em relação ao ideal de hoje (${pts(g.behindPoints)} da meta${g.behindPoints > INVEST_TOLERANCE ? ", acima da tolerância de 2%" : ", dentro da tolerância de 2%"})`
      : `Adiantado ${brl(-g.gap)} em relação ao ideal de hoje`;
  const conta =
    g.daysLeft > 0
      ? `Ritmo = o que falta (${brl(g.remaining)}) ÷ ${g.daysLeft} dia(s) que faltam depois de hoje`
      : `Último dia do mês: Ritmo = o que falta pra meta (${brl(g.remaining)})`;
  return (
    `Investimento mensal: ${brl(monthlyInvestment)} ÷ ${daysInMonth} dias = ${brl(g.normal)} por dia\n` +
    `Ideal até hoje (dia ${day}): ${brl(g.ideal)}\n` +
    `Gasto de 01 até agora (com hoje): ${brl(spent)}\n` +
    `${situacao}\n` +
    `${conta}\n` +
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
