// Regras da Speed (painel da agência, speed-manager-web-ten.vercel.app) — Etapa 185.
// O Anderson segue o painel da Speed à risca, mas com o dado AO VIVO. Tudo aqui foi conferido
// contra a Speed e contra a Meta em 21/10/2026 (Rio Verde 2, Ji-Paraná 2, Novo Hamburgo fecharam no centavo):
//  - Investimento = gasto do dia 01, sem campanhas [VAGA] (o resto todo entra, inclusive tráfego/visitas ao perfil).
//  - CPA = investimento TOTAL ÷ conversas (lib/meta/insights.ts e daily-cpa.ts já calculam assim).
//  - Ideal até hoje = Investimento mensal ÷ dias reais do mês × dia de hoje (contando hoje).
//  - Status do investimento: a Speed compara o gasto ATÉ ONTEM com o ideal ATÉ HOJE, com 2% de folga
//    pros dois lados (21/10: RO Marechal −1,6% = OK; Blumenau −2,8% = alerta — 15 de 15 contas bateram).
//  - Status do CPA: no CPA ideal ou abaixo = OK; até R$ 1,20 acima = Aceitável; mais que isso = Acima
//    (21/10: +R$ 1,15 ainda Aceitável e +R$ 1,45 já Acima — o corte exato da Speed está entre os dois).
//  - "Custo/dia" da Speed = (meta − gasto até ontem) ÷ dias que faltam contando hoje (fica na dica).
// Gastar hoje / Gastar amanhã (regra do Anderson): alvo é a META CHEIA (100%), não os 98% da folga.
// Conta no ritmo = ritmo médio (meta ÷ dias do mês); conta atrasada = ritmo + atraso, com teto fixo de
// 2x o ritmo médio por dia pra recuperar o quanto antes sem forçar o CPA.

import { monthCalendarSP } from "./ritmo";

export const SPEED_INVEST_TOLERANCE = 0.02; // 2% do ideal até hoje, pros dois lados
export const SPEED_CPA_ACCEPTABLE = 1.2; // R$ acima do CPA ideal que a Speed ainda chama de "Aceitável"
export const SPEED_MAX_MULT = 2; // teto do Gastar hoje/amanhã: 2x o ritmo médio por dia

export type SpeedInvest = "below" | "ok" | "above";
export type SpeedCpa = "ok" | "acceptable" | "high";
export type SpeedOverall = "ok" | "acceptable" | "off";

export interface SpeedInput {
  monthlyTarget: number | null; // Investimento mensal cadastrado
  spentSoFar: number | null; // gasto do dia 01 até agora (com hoje)
  spentUntilYesterday: number | null; // gasto do dia 01 até ontem (o que a Speed mostra)
  cpa: number | null; // CPA do mês até agora (regra da Speed)
  cpaTarget: number | null; // CPA ideal cadastrado
  dailyBudget?: number | null; // orçamento diário atual da conta
}

export interface SpeedRow {
  day: number;
  daysInMonth: number;
  normal: number | null; // ritmo médio: meta ÷ dias do mês
  cap: number | null; // teto por dia (2x o ritmo médio)
  idealToday: number | null; // ideal até hoje (contando hoje)
  speedDiff: number | null; // gasto até ontem − ideal até hoje (R$) — a conta que a Speed faz
  speedDiffPct: number | null; // speedDiff ÷ ideal até hoje
  investStatus: SpeedInvest | null;
  custoDia: number | null; // "Custo/dia" da Speed
  spentToday: number | null;
  gastarHoje: number | null; // quanto ainda falta gastar HOJE (ao vivo)
  gastarAmanha: number | null; // orçamento pra amanhã (null no último dia do mês)
  okInDays: number | null; // 0 = já OK na Speed hoje; N = a Speed mostra OK daqui a N dia(s); null = não volta este mês
  cpa: number | null;
  cpaTarget: number | null;
  cpaDiff: number | null;
  cpaStatus: SpeedCpa | null;
  overall: SpeedOverall | null;
}

function investBand(spentUntilYesterday: number, ideal: number): SpeedInvest {
  if (!(ideal > 0)) return "ok";
  const pct = (spentUntilYesterday - ideal) / ideal;
  if (pct < -SPEED_INVEST_TOLERANCE) return "below";
  if (pct > SPEED_INVEST_TOLERANCE) return "above";
  return "ok";
}

export function speedCpaStatus(cpa: number | null, cpaTarget: number | null): SpeedCpa | null {
  if (cpa == null || cpaTarget == null) return null;
  const diff = cpa - cpaTarget;
  if (diff <= 0.004) return "ok";
  if (diff <= SPEED_CPA_ACCEPTABLE + 0.004) return "acceptable";
  return "high";
}

export function computeSpeed(input: SpeedInput, now: Date = new Date()): SpeedRow {
  const { day, daysInMonth } = monthCalendarSP(now);
  const T = input.monthlyTarget != null && input.monthlyTarget > 0 ? input.monthlyTarget : null;
  const spentSoFar = input.spentSoFar;
  const until = input.spentUntilYesterday;

  let normal: number | null = null;
  let cap: number | null = null;
  let idealToday: number | null = null;
  let speedDiff: number | null = null;
  let speedDiffPct: number | null = null;
  let investStatus: SpeedInvest | null = null;
  let custoDia: number | null = null;
  let spentToday: number | null = null;
  let gastarHoje: number | null = null;
  let gastarAmanha: number | null = null;
  let okInDays: number | null = null;

  if (until != null && spentSoFar != null) spentToday = Math.max(0, spentSoFar - until);

  if (T != null) {
    const n = T / daysInMonth;
    normal = n;
    cap = n * SPEED_MAX_MULT;
    const ideal = (d: number) => n * Math.min(d, daysInMonth);
    idealToday = ideal(day);
    if (until != null) {
      speedDiff = until - idealToday;
      speedDiffPct = idealToday > 0 ? speedDiff / idealToday : null;
      investStatus = investBand(until, idealToday);
      custoDia = Math.max(0, T - until) / Math.max(1, daysInMonth - day + 1);
    }
    // Etapa 188: sem o gasto até ontem (backup de outro dia / busca falhou) não dá pra saber o gasto de hoje
    // nem aplicar o teto — não chuta número.
    if (spentSoFar != null && spentToday != null) {
      // Hoje: amanhã a Speed compara o gasto até o fim de hoje com o ideal de amanhã.
      let hoje = Math.max(0, ideal(day + 1) - spentSoFar);
      hoje = Math.min(hoje, Math.max(0, cap - spentToday));
      gastarHoje = hoje;
      const endToday = spentSoFar + hoje;
      if (day < daysInMonth) {
        gastarAmanha = Math.min(cap, Math.max(0, ideal(day + 2) - endToday));
      }
      // Em quantos dias a Speed mostra OK, seguindo as recomendações daqui pra frente.
      if (investStatus === "ok") okInDays = 0;
      else {
        let s = endToday;
        for (let k = 1; day + k <= daysInMonth; k++) {
          if (investBand(s, ideal(day + k)) === "ok") {
            okInDays = k;
            break;
          }
          s += Math.min(cap, Math.max(0, ideal(day + k + 1) - s));
        }
      }
    }
  }

  const cpaDiff = input.cpa != null && input.cpaTarget != null ? input.cpa - input.cpaTarget : null;
  const cpaStatus = speedCpaStatus(input.cpa, input.cpaTarget);
  let overall: SpeedOverall | null = null;
  if (investStatus != null || cpaStatus != null) {
    if (investStatus === "below" || investStatus === "above" || cpaStatus === "high") overall = "off";
    else if (cpaStatus === "acceptable") overall = "acceptable";
    else overall = "ok";
  }

  return {
    day,
    daysInMonth,
    normal,
    cap,
    idealToday,
    speedDiff,
    speedDiffPct,
    investStatus,
    custoDia,
    spentToday,
    gastarHoje,
    gastarAmanha,
    okInDays,
    cpa: input.cpa,
    cpaTarget: input.cpaTarget,
    cpaDiff,
    cpaStatus,
    overall,
  };
}

// Ordem "Fora da meta (Speed)": fora (vermelho) → aceitável (laranja) → OK (verde) → sem dado.
// Dentro do grupo, quem está mais longe (CPA acima em % do ideal + distância do investimento em %).
export function speedSortKey(r: SpeedRow): number {
  if (r.overall == null) return Number.NEGATIVE_INFINITY;
  const group = r.overall === "off" ? 3 : r.overall === "acceptable" ? 2 : 1;
  const cpaPart = r.cpaDiff != null && r.cpaTarget ? Math.max(r.cpaDiff, 0) / r.cpaTarget : 0;
  const investPart = r.speedDiffPct != null ? Math.abs(r.speedDiffPct) : 0;
  return group * 1000 + cpaPart + investPart;
}

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const SPEED_INVEST_LABEL: Record<SpeedInvest, string> = { below: "Abaixo", ok: "OK", above: "Acima" };
export const SPEED_CPA_LABEL: Record<SpeedCpa, string> = { ok: "OK", acceptable: "Aceitável", high: "Acima" };

export function speedOkText(r: SpeedRow): string {
  if (r.investStatus == null) return "";
  if (r.okInDays === 0) return "Na Speed: OK hoje";
  if (r.okInDays === 1) return "Volta ao OK na Speed amanhã";
  if (r.okInDays != null) return `Volta ao OK na Speed em ${r.okInDays} dias`;
  return "Não volta ao OK na Speed este mês, mesmo no teto";
}

// Dica (ao passar o mouse) do Gastar hoje / amanhã — os números que entraram na conta.
export function speedBudgetTooltip(r: SpeedRow, monthlyTarget: number | null): string {
  if (monthlyTarget == null || r.normal == null) return "Sem Investimento mensal cadastrado — não dá pra calcular.";
  const lines = [
    `Meta do mês: ${brl(monthlyTarget)} ÷ ${r.daysInMonth} dias = ritmo médio ${brl(r.normal)} (teto ${brl(r.cap ?? 0)}/dia)`,
    `Ideal até hoje (dia ${r.day}): ${brl(r.idealToday ?? 0)}`,
  ];
  if (r.speedDiff != null && r.speedDiffPct != null && r.spentToday != null) {
    lines.push(`Gasto até ontem (o que a Speed vê): ${brl((r.idealToday ?? 0) + r.speedDiff)} (${pct(r.speedDiffPct)} do ideal; folga da Speed ±2%)`);
    lines.push(`Gasto hoje até agora: ${brl(r.spentToday)}`);
  }
  if (r.gastarHoje != null) lines.push(`Gastar hoje: ${brl(r.gastarHoje)} a mais até o fim do dia`);
  if (r.gastarAmanha != null) lines.push(`Gastar amanhã: ${brl(r.gastarAmanha)} (orçamento pra configurar)`);
  else lines.push("Último dia do mês: não tem amanhã.");
  if (r.custoDia != null) lines.push(`Custo/dia da Speed: ${brl(r.custoDia)}`);
  const ok = speedOkText(r);
  if (ok) lines.push(ok);
  return lines.join("\n");
}
