import { isNonLeadResultType } from "./shared";

// Etapa 125: parte "pura" (sem banco, sem Meta) do backup diário — resolve o período pedido em datas e
// decide o que vem do backup (dias fechados guardados) e o que ainda precisa ser perguntado à Meta
// (hoje, ou qualquer dia que falte no backup). Tudo em datas de texto YYYY-MM-DD (fuso de Brasília),
// sem Date local, pra dar o mesmo resultado em qualquer servidor.

// Janela móvel: guarda os últimos 37 dias fechados (ontem pra trás). Dia 1º de um mês de 31 dias ainda
// enxerga o mês anterior inteiro + 6 dias do anterior a esse, o suficiente pra "últimos 7 dias".
export const STORE_DAYS = 37;

export interface DayRow {
  day: string;
  spend: number;
  cpaSpend: number;
  results: number;
  types: string[];
}

// Dia suspeito (Etapa 178): tem resultados mas NENHUM gasto. Não existe na vida real (conversa sem gasto no dia) — é sinal de que a Meta
// devolveu a linha sem o gasto na hora da cópia. Esse dia nunca é gravado e, se já estiver gravado, não é usado (a Meta responde no lugar).
export function isSuspectDay(r: { spend: number; cpaSpend: number; results: number }): boolean {
  return r.results > 0 && r.spend <= 0 && r.cpaSpend <= 0;
}

export interface YmdRange {
  since: string;
  until: string;
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function todayBrt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Primeiro dia que ainda é guardado (hoje - 37).
export function oldestKeptDay(today: string): string {
  return addDaysYmd(today, -STORE_DAYS);
}

// Mesmas definições do date_preset da Graph API usadas hoje no sistema. Devolve null pra período que o
// backup não sabe resolver ("maximum", nomes desconhecidos) — aí o caminho antigo (Meta direto) vale.
export function resolveRange(
  preset: string | YmdRange,
  today: string,
): YmdRange | null {
  if (typeof preset === "object" && preset && "since" in preset) {
    return preset.since <= preset.until ? { since: preset.since, until: preset.until } : null;
  }
  const y = addDaysYmd(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "today":
      return { since: today, until: today };
    case "yesterday":
      return { since: y, until: y };
    case "today_yesterday":
      return { since: y, until: today };
    case "last_3d":
      return { since: addDaysYmd(today, -3), until: y };
    case "last_3d_plus_today":
      return { since: addDaysYmd(today, -3), until: today };
    case "last_7d":
      return { since: addDaysYmd(today, -7), until: y };
    case "this_month":
      return { since: monthStart, until: today };
    case "this_month_until_yesterday": {
      // dia 1º: não há dia fechado no mês — igual ao presetParams (usa o próprio dia 1)
      const until = y < monthStart ? monthStart : y;
      return { since: monthStart, until };
    }
    default:
      return null;
  }
}

export interface RangePlan {
  // dias fechados que vêm do backup, em ordem
  used: DayRow[];
  // o que ainda precisa ser perguntado à Meta (hoje e/ou dias que faltam no backup); null = nada
  live: YmdRange | null;
}

// Percorre o período dia a dia: enquanto o dia é fechado (antes de hoje) e está no backup, usa o backup.
// No primeiro dia que for hoje ou que faltar, a Meta responde dali até o fim do período (não mistura:
// dias guardados DEPOIS de um buraco são ignorados, pra nunca contar o mesmo dia duas vezes).
export function planRange(range: YmdRange, today: string, stored: Map<string, DayRow>): RangePlan {
  const used: DayRow[] = [];
  let d = range.since;
  while (d <= range.until) {
    const row = d < today ? stored.get(d) : undefined;
    if (!row) return { used, live: { since: d, until: range.until } };
    used.push(row);
    d = addDaysYmd(d, 1);
  }
  return { used, live: null };
}

export function sumDayRows(rows: DayRow[]): { spend: number; cpaSpend: number; results: number } {
  let spend = 0;
  let cpaSpend = 0;
  let results = 0;
  for (const r of rows) {
    spend += r.spend;
    cpaSpend += r.cpaSpend;
    results += r.results;
  }
  return { spend, cpaSpend, results };
}

// Linha de insights por campanha/dia -> linha do backup do dia. `excludedIds` = campanhas de objetivo
// fora do CPA. Mesma regra de getAccountInsight: [VAGA] fora de tudo; seguidores/tráfego/objetivo
// excluído entram só no investimento (spend), nunca em cpaSpend/resultado.
export interface CampaignDayInput {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  resultValue: number | null;
  resultType: string | null;
}

export function buildDayRows(
  range: YmdRange,
  rows: CampaignDayInput[],
  excludedIds: Set<string>,
  isJob: (name?: string) => boolean,
  isVagaName: (name?: string) => boolean,
): DayRow[] {
  const byDay = new Map<string, { spend: number; cpaSpend: number; results: number; types: Set<string> }>();
  for (const r of rows) {
    if (!r.date_start) continue;
    if (isJob(r.campaign_name)) continue;
    const cur = byDay.get(r.date_start) ?? { spend: 0, cpaSpend: 0, results: 0, types: new Set<string>() };
    const s = r.spend ? Number(r.spend) : 0;
    cur.spend += s;
    // Etapa 184: resultado que não é lead/conversa (interação no post, clique, alcance…) não conta no CPA — só no gasto.
    const counts = !isNonLeadResultType(r.resultType) && !isVagaName(r.campaign_name) && !(r.campaign_id && excludedIds.has(r.campaign_id));
    if (counts) {
      cur.cpaSpend += s;
      if (r.resultValue != null && r.resultValue > 0) {
        cur.results += r.resultValue;
        if (r.resultType) cur.types.add(r.resultType);
      }
    }
    byDay.set(r.date_start, cur);
  }
  // Uma linha pra TODO dia do período (zeros se a conta não gastou) — é isso que diz "esse dia já foi
  // conferido" e impede de perguntar à Meta de novo.
  const out: DayRow[] = [];
  for (let d = range.since; d <= range.until; d = addDaysYmd(d, 1)) {
    const v = byDay.get(d);
    out.push({ day: d, spend: v?.spend ?? 0, cpaSpend: v?.cpaSpend ?? 0, results: v?.results ?? 0, types: v ? [...v.types] : [] });
  }
  return out;
}
