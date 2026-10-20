// Melhor público por conta (Etapa 164) — código puro (sem Meta/banco), testável.
// Entrada: linhas faixa-etária × gênero × tipo (GERAL/EXAME) dos últimos 14 dias fechados. Saída: tabela faixa × gênero com CPA,
// e o "melhor" de cada eixo = MENOR CPA entre os que têm pelo menos MIN_CONV conversas (amostra pequena engana).

export const AUDIENCE_DAYS = 14;
export const MIN_CONV = 3;

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

export interface AudienceSummary {
  type: AudType;
  total: Cell;
  ages: Array<{ age: string } & Cell & { share: number }>; // share = % do gasto
  genders: Array<{ gender: "female" | "male" | "unknown" } & Cell & { share: number }>;
  cells: Record<string, Cell>; // chave `${age}|${gender}`
  bestAge: string | null;
  bestGender: "female" | "male" | null;
  bestCombo: { age: string; gender: "female" | "male" } | null;
}

export const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

export const GENDER_LABEL: Record<AudGender, string> = { female: "Mulher", male: "Homem", unknown: "Não informado" };

const mkCell = (spend: number, conv: number): Cell => ({ spend, conv, cpa: conv > 0 ? spend / conv : null });

function best<T extends Cell>(items: T[]): T | null {
  const ok = items.filter((i) => i.cpa != null && i.conv >= MIN_CONV);
  if (ok.length === 0) return null;
  return ok.sort((a, b) => (a.cpa as number) - (b.cpa as number) || b.conv - a.conv)[0];
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
  const ages = [...byAge.entries()]
    .map(([age, c]) => ({ age, ...mkCell(c.spend, c.conv), share: spend > 0 ? (c.spend / spend) * 100 : 0 }))
    .sort((a, b) => AGE_ORDER.indexOf(a.age) - AGE_ORDER.indexOf(b.age));
  const genders = [...byGender.entries()]
    .map(([gender, c]) => ({ gender, ...mkCell(c.spend, c.conv), share: spend > 0 ? (c.spend / spend) * 100 : 0 }))
    .sort((a, b) => b.spend - a.spend);
  const cells: Record<string, Cell> = {};
  for (const [k, c] of cellsRaw) cells[k] = mkCell(c.spend, c.conv);

  const bestAgeRow = best(ages);
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
    bestAge: bestAgeRow?.age ?? null,
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
