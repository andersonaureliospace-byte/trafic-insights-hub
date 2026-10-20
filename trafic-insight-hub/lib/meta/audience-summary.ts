// Melhor público por conta (Etapas 164 e 167) — código puro (sem Meta/banco), testável.
// Entrada: linhas faixa-etária × gênero × tipo (GERAL/EXAME) de uma janela de dias fechados (7, 14 ou 30). Saída: tabela faixa × gênero com CPA/conversas e
//  - FAIXA SUGERIDA (Etapa 167): por VOLUME de conversas iniciadas (não por custo). Sempre uma faixa contínua (sem pular), com no mínimo 2 faixas da Meta
//    (ideal 3). Se as faixas têm volume parecido (ou quase nada de dado), sugere todas — inclusive as zeradas.
//  - melhor gênero e melhor combinação: continuam pelo MENOR CPA entre os que têm pelo menos MIN_CONV conversas (amostra pequena engana).

export const AUDIENCE_DAYS = 14; // janela padrão
export const WINDOWS = [7, 14, 30] as const;
export type WindowDays = (typeof WINDOWS)[number];
export type PeriodMode = "auto" | "7" | "14" | "30";
export const MIN_CONV = 3;
// Modo automático: se o tipo teve menos conversas que isso em 14 dias, usa 30 dias (mais dado).
export const AUTO_MIN_CONV = 20;

// Faixa sugerida: "parecido" = diferença de até 2 conversas, ou a menor faixa com pelo menos 60% da maior.
const NEAR_SMALL_DIFF = 2;
const NEAR_RATIO = 0.6;
// Ponta fraca (menos de 25% da faixa mais forte do grupo) é cortada, mas nunca abaixo de 2 faixas.
const WEAK_RATIO = 0.25;

export type AudType = "GERAL" | "EXAME";
export type AudGender = "female" | "male" | "unknown";

export interface AudRow {
  type: AudType;
  age: string; // faixa da Meta: 18-24, 25-34, 35-44, 45-54, 55-64, 65+
  gender: AudGender;
  spend: number;
  conv: number;
}

export interface Cell {
  spend: number;
  conv: number;
  cpa: number | null;
}

export interface AgeRange {
  ages: string[]; // faixas da Meta dentro da sugestão, em ordem
  label: string; // "18-34", "25-64", "Todas (18-65+)"
  all: boolean;
}

export interface AudienceSummary {
  type: AudType;
  total: Cell;
  ages: Array<{ age: string } & Cell & { share: number; convShare: number }>; // share = % do gasto; convShare = % das conversas
  genders: Array<{ gender: "female" | "male" | "unknown" } & Cell & { share: number }>;
  cells: Record<string, Cell>; // chave `${age}|${gender}`
  ageRange: AgeRange | null;
  bestGender: "female" | "male" | null;
  bestCombo: { age: string; gender: "female" | "male" } | null;
}

export const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
// Faixas que entram na sugestão (anúncio de 18+). 13-17 só aparece na tabela se a Meta entregou algo.
export const STD_AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

export const GENDER_LABEL: Record<AudGender, string> = { female: "Mulher", male: "Homem", unknown: "Não informado" };

// Faixa "Unknown" (a Meta não soube a idade) vai por último.
const ageIdx = (age: string) => {
  const i = AGE_ORDER.indexOf(age);
  return i < 0 ? 99 : i;
};

const mkCell = (spend: number, conv: number): Cell => ({ spend, conv, cpa: conv > 0 ? spend / conv : null });

function best<T extends Cell>(items: T[]): T | null {
  const ok = items.filter((i) => i.cpa != null && i.conv >= MIN_CONV);
  if (ok.length === 0) return null;
  return ok.sort((a, b) => (a.cpa as number) - (b.cpa as number) || b.conv - a.conv)[0];
}

function rangeLabel(ages: string[], all: boolean): string {
  const from = ages[0].replace("+", "").split("-")[0];
  const lastBand = ages[ages.length - 1];
  const to = lastBand === "65+" ? "65+" : lastBand.split("-")[1];
  return all ? `Todas (${from}-${to})` : `${from}-${to}`;
}

// Faixa etária sugerida pelo VOLUME de conversas por faixa (STD_AGES). Devolve null se não houve nenhuma conversa.
export function suggestAgeRange(convByAge: Record<string, number>): AgeRange | null {
  const v = STD_AGES.map((a) => convByAge[a] ?? 0);
  const total = v.reduce((s, x) => s + x, 0);
  if (total <= 0) return null;
  const last = v.length - 1;
  const mk = (lo: number, hi: number): AgeRange => {
    const ages = STD_AGES.slice(lo, hi + 1);
    const all = lo === 0 && hi === last;
    return { ages, all, label: rangeLabel(ages, all) };
  };
  const max = Math.max(...v);
  const min = Math.min(...v);
  // Tudo parecido (ou pouquíssimo dado): sugere todas, até as zeradas.
  if (max - min <= NEAR_SMALL_DIFF || min >= max * NEAR_RATIO) return mk(0, last);

  // Melhor janela de 3 faixas seguidas (maior soma de conversas).
  let lo = 0;
  let bestSum = -1;
  for (let i = 0; i + 2 <= last; i++) {
    const s = v[i] + v[i + 1] + v[i + 2];
    if (s > bestSum) {
      bestSum = s;
      lo = i;
    }
  }
  let hi = lo + 2;
  const peak = () => Math.max(...v.slice(lo, hi + 1));
  // Estica pro lado se a faixa vizinha tem volume parecido com a mais forte.
  for (;;) {
    const l = lo > 0 ? v[lo - 1] : -1;
    const r = hi < last ? v[hi + 1] : -1;
    const c = Math.max(l, r);
    if (c < 0 || c < peak() * NEAR_RATIO) break;
    if (l >= r) lo--;
    else hi++;
  }
  // Corta ponta fraca, mas mantém pelo menos 2 faixas.
  while (hi - lo + 1 > 2) {
    const p = peak();
    const weakL = v[lo] < p * WEAK_RATIO;
    const weakR = v[hi] < p * WEAK_RATIO;
    if (!weakL && !weakR) break;
    if (weakL && (!weakR || v[lo] <= v[hi])) lo++;
    else hi--;
  }
  return mk(lo, hi);
}

export function summarizeAudience(rows: AudRow[], type: AudType): AudienceSummary {
  const mine = rows.filter((r) => r.type === type);
  const byAge = new Map<string, { spend: number; conv: number }>();
  const byGender = new Map<AudGender, { spend: number; conv: number }>();
  const cellsRaw = new Map<string, { spend: number; conv: number }>();
  let spend = 0;
  let conv = 0;
  const add = <K,>(m: Map<K, { spend: number; conv: number }>, k: K, r: AudRow) => {
    const c = m.get(k) ?? { spend: 0, conv: 0 };
    c.spend += r.spend;
    c.conv += r.conv;
    m.set(k, c);
  };
  for (const r of mine) {
    spend += r.spend;
    conv += r.conv;
    add(byAge, r.age, r);
    add(byGender, r.gender, r);
    add(cellsRaw, `${r.age}|${r.gender}`, r);
  }
  // Faixas padrão sempre aparecem (zeradas também); 13-17 só se houve entrega.
  if (spend > 0 || conv > 0) for (const a of STD_AGES) if (!byAge.has(a)) byAge.set(a, { spend: 0, conv: 0 });
  const ages = [...byAge.entries()]
    .map(([age, c]) => ({
      age,
      ...mkCell(c.spend, c.conv),
      share: spend > 0 ? (c.spend / spend) * 100 : 0,
      convShare: conv > 0 ? (c.conv / conv) * 100 : 0,
    }))
    .sort((a, b) => ageIdx(a.age) - ageIdx(b.age));
  const genders = [...byGender.entries()]
    .map(([gender, c]) => ({ gender, ...mkCell(c.spend, c.conv), share: spend > 0 ? (c.spend / spend) * 100 : 0 }))
    .sort((a, b) => b.spend - a.spend);
  const cells: Record<string, Cell> = {};
  for (const [k, c] of cellsRaw) cells[k] = mkCell(c.spend, c.conv);

  const bestGenderRow = best(genders.filter((g) => g.gender !== "unknown"));
  const combos = [...cellsRaw.entries()]
    .filter(([k]) => !k.endsWith("|unknown"))
    .map(([k, c]) => {
      const [age, gender] = k.split("|");
      return { age, gender: gender as "female" | "male", ...mkCell(c.spend, c.conv) };
    });
  const bestComboRow = best(combos);
  return {
    type,
    total: mkCell(spend, conv),
    ages,
    genders,
    cells,
    ageRange: suggestAgeRange(Object.fromEntries(ages.map((a) => [a.age, a.conv]))),
    bestGender: (bestGenderRow?.gender as "female" | "male" | undefined) ?? null,
    bestCombo: bestComboRow ? { age: bestComboRow.age, gender: bestComboRow.gender } : null,
  };
}

// Junta as linhas de várias contas (rede toda).
export function mergeRows(lists: AudRow[][]): AudRow[] {
  const m = new Map<string, AudRow>();
  for (const list of lists)
    for (const r of list) {
      const k = `${r.type}|${r.age}|${r.gender}`;
      const cur = m.get(k);
      if (cur) {
        cur.spend += r.spend;
        cur.conv += r.conv;
      } else m.set(k, { ...r });
    }
  return [...m.values()];
}

// Retrato de uma conta: `windows` (7/14/30 dias) a partir da Etapa 167; `rows` = a janela de 14 dias (retratos antigos só têm isso).
export interface WindowedRows {
  rows: AudRow[];
  windows?: Partial<Record<string, AudRow[]>>;
}

export interface ChosenRows {
  rows: AudRow[];
  days: number;
  widened: boolean; // modo automático subiu pra 30 dias por falta de dado
  missing: boolean; // pediu 7/30 mas o retrato ainda é o antigo (só 14) — "Atualizar agora" resolve
}

const convOf = (rows: AudRow[], type: AudType) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.conv, 0);

// Escolhe a janela de uma conta para um tipo. Automático = 14 dias, ou 30 se o tipo teve menos de AUTO_MIN_CONV conversas em 14.
export function chooseRows(e: WindowedRows, type: AudType, mode: PeriodMode): ChosenRows {
  const w14 = e.windows?.["14"] ?? e.rows;
  if (mode === "auto") {
    const w30 = e.windows?.["30"];
    if (w30 && convOf(w14, type) < AUTO_MIN_CONV) return { rows: w30, days: 30, widened: true, missing: false };
    return { rows: w14, days: 14, widened: false, missing: false };
  }
  const d = Number(mode);
  if (d === 14) return { rows: w14, days: 14, widened: false, missing: false };
  const w = e.windows?.[mode];
  if (w) return { rows: w, days: d, widened: false, missing: false };
  return { rows: w14, days: 14, widened: false, missing: true };
}
