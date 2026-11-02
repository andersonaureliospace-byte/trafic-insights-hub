// Etapa 238 (Hub estratégico): contas puras (sem Meta, sem React) da tela Tráfego.
// Tudo sai dos pontos diários de /api/meta/daily-cpa (dias fechados do backup + hoje ao vivo).

import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";

export type CpaPeriod = "h" | "o" | "oh" | "u2" | "u3" | "u2h" | "u3h";

export const CPA_PERIODS: Array<{ id: CpaPeriod; label: string; short: string }> = [
  { id: "h", label: "Hoje", short: "hoje" },
  { id: "o", label: "Ontem", short: "ontem" },
  { id: "oh", label: "Ontem + hoje", short: "ontem + hoje" },
  { id: "u2", label: "Últimos 2 dias", short: "últ. 2 dias" },
  { id: "u3", label: "Últimos 3 dias", short: "últ. 3 dias" },
  { id: "u2h", label: "Últimos 2 dias + hoje", short: "últ. 2 dias + hoje" },
  { id: "u3h", label: "Últimos 3 dias + hoje", short: "últ. 3 dias + hoje" },
];

export interface Sum {
  spend: number;
  results: number;
}

// CPA: null = sem gasto; Infinity = gastou e não teve conversa.
export function cpaOf(s: Sum | null | undefined): number | null {
  if (!s || s.spend <= 0) return null;
  if (s.results <= 0) return Infinity;
  return s.spend / s.results;
}

// Hoje (YYYY-MM-DD), dia do mês e dias do mês no fuso de Brasília.
export function calendarSP(now: Date = new Date()): { today: string; day: number; daysInMonth: number; monthStart: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return {
    today: `${y}-${m}-${d}`,
    day: Number(d),
    daysInMonth: new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate(),
    monthStart: `${y}-${m}-01`,
  };
}

const add = (a: Sum, b: Sum | undefined): Sum => (b ? { spend: a.spend + b.spend, results: a.results + b.results } : a);
const sum = (list: Array<Sum | undefined>): Sum => list.reduce<Sum>((acc, x) => add(acc, x), { spend: 0, results: 0 });

// Quantos dias fechados do mês atual entram em cada período (pra avisar quando o período foi cortado no começo do mês).
export function closedDaysIn(period: CpaPeriod, cal = calendarSP()): { wanted: number; got: number } {
  const wanted = { h: 0, o: 1, oh: 1, u2: 2, u3: 3, u2h: 2, u3h: 3 }[period];
  return { wanted, got: Math.min(wanted, cal.day - 1) };
}

export interface AccountNumbers {
  todaySpend: number;
  monthSpend: number; // dia 01 até agora (com hoje)
  untilYesterday: number; // dia 01 até ontem
  periods: Record<CpaPeriod, Sum>;
  month: Sum;
}

export function numbersFrom(points: DailyCpaPoint[], cal = calendarSP()): AccountNumbers {
  const today = points.find((p) => p.date === cal.today);
  // Etapa 242: só o mês atual. No dia 02, "últimos 3 dias" = só o dia 01 (os dias do mês anterior ficam de fora).
  const closed = points.filter((p) => p.date < cal.today && p.date >= cal.monthStart).sort((a, b) => a.date.localeCompare(b.date));
  const n = closed.length;
  const o = closed[n - 1];
  const o2 = closed[n - 2];
  const o3 = closed[n - 3];
  const untilYesterday = sum(closed);
  const month = add(untilYesterday, today);
  return {
    todaySpend: today?.spend ?? 0,
    monthSpend: month.spend,
    untilYesterday: untilYesterday.spend,
    month,
    periods: {
      h: sum([today]),
      o: sum([o]),
      oh: sum([o, today]),
      u2: sum([o2, o]),
      u3: sum([o3, o2, o]),
      u2h: sum([o2, o, today]),
      u3h: sum([o3, o2, o, today]),
    },
  };
}

// Ritmo (regra do Hub estratégico): a média que a conta investiu por dia no mês (dia 01 até ontem) e quanto falta investir
// pra ficar em dia com a meta até ontem: meta ÷ dias do mês × dias que já passaram − gasto até ontem.
// gap positivo = está abaixo (falta investir); negativo = passou da meta até aqui. No dia 01 ainda não há média.
export interface Ritmo {
  avg: number | null;
  gap: number | null;
  dailyTarget: number | null;
}
export function ritmoOf(monthly: number | null, untilYesterday: number, cal = calendarSP()): Ritmo {
  const passed = cal.day - 1;
  const avg = passed > 0 ? untilYesterday / passed : null;
  if (!monthly || monthly <= 0) return { avg, gap: null, dailyTarget: null };
  const dailyTarget = monthly / cal.daysInMonth;
  return { avg, gap: passed > 0 ? dailyTarget * passed - untilYesterday : null, dailyTarget };
}

// Diferença mínima (R$) pra considerar a conta fora do ritmo — a mesma faixa de R$ 10 do hub antigo.
export const RITMO_BAND = 10;

export type Tone = "ok" | "warn" | "bad" | "info" | "off";

export function cpaTone(cpa: number | null, target: number | null): Tone {
  if (cpa == null || target == null) return "off";
  if (cpa <= target) return "ok";
  if (cpa <= target + 2) return "warn";
  return "bad";
}

export function ritmoTone(gap: number | null): Tone {
  if (gap == null) return "off";
  if (Math.abs(gap) < RITMO_BAND) return "ok";
  return gap > 0 ? "warn" : "info";
}

// Pior primeiro: sem resultado com gasto > CPA alto acima do ideal > ... > sem gasto.
export function cpaSortKey(cpa: number | null, target: number | null): number {
  if (cpa == null) return -1e9;
  if (cpa === Infinity) return 1e9;
  return target != null ? cpa - target : cpa;
}
