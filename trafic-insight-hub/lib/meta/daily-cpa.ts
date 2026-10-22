// CPA diário por conta — portado do app anterior (getAccountsDailyCpa em
// src/lib/meta.functions.ts). Usado pela atualização de status em massa
// (classifica a prioridade da conta pelo CPA dos últimos dias) e serve
// também de base para eventuais gráficos futuros.

import { metaGet, metaGetAll, spDate } from "./client";
import { isVaga, EXCLUDED_OBJECTIVES, isNonLeadResultType, leadResultOf } from "./shared";
import { memoMeta } from "./memo";
import { closedDaysFor, hasAllClosedDays, normAccountId } from "./daily-store";

// Soma/subtrai dias de uma data YYYY-MM-DD só no calendário (UTC puro, sem
// fuso nem horário de verão), então dá o mesmo resultado em qualquer servidor.
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface DailyCpaPoint {
  date: string;
  spend: number;
  results: number;
  cpa: number | null;
}

interface CampaignRow {
  id?: string;
  name?: string;
  objective?: string;
}

interface DailyInsightRow {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type?: string; value?: string }>;
}

// Etapa 125: lista de campanhas excluídas guardada por 2 min (várias partes da mesma tela pedem junto);
// se a Meta falhar, devolve vazio e NÃO guarda o vazio (a próxima chamada tenta de novo).
async function getExcludedCampaignIds(token: string, id: string): Promise<Set<string>> {
  try {
    return await memoMeta(`daily-excl:${id}:${token.slice(-10)}`, 120_000, async () => {
      const excluded = new Set<string>();
      const camps = await metaGet<{ data: CampaignRow[] }>(token, `/${id}/campaigns`, {
        fields: "id,name,objective",
        limit: "500",
      });
      for (const c of camps.data ?? []) {
        if (!c.id) continue;
        if (isVaga(c.name) || (c.objective && EXCLUDED_OBJECTIVES.has(c.objective))) {
          excluded.add(c.id);
        }
      }
      return excluded;
    });
  } catch (e) {
    console.error("daily-cpa campaigns err", id, e);
    return new Set<string>();
  }
}

async function getAccountDailyCpa(
  token: string,
  actId: string,
  since: string,
  until: string,
  excluded: Set<string>,
): Promise<DailyCpaPoint[]> {
  const id = actId.startsWith("act_") ? actId : `act_${actId}`;

  const byDate = new Map<string, { spend: number; results: number }>();
  try {
    const rows = await metaGetAll<DailyInsightRow>(token, `/${id}/insights`, {
      fields: "date_start,campaign_id,campaign_name,spend,results,actions",
      time_range: JSON.stringify({ since, until }),
      time_increment: "1",
      level: "campaign",
      limit: "500",
      use_unified_attribution_setting: "true",
    });
    for (const row of rows) {
      if (!row.date_start) continue;
      if (isVaga(row.campaign_name)) continue;
      if (row.campaign_id && excluded.has(row.campaign_id)) continue;
      const lr = leadResultOf(row.results, row.actions);
      if (isNonLeadResultType(lr.type)) continue; // Etapa 184: interação/clique/alcance não é lead (conversas em `actions` valem)
      const cur = byDate.get(row.date_start) ?? { spend: 0, results: 0 };
      cur.spend += row.spend ? Number(row.spend) : 0;
      const r = lr.value;
      if (r != null) cur.results += r;
      byDate.set(row.date_start, cur);
    }
  } catch (e) {
    console.error("daily-cpa insights err", id, e);
  }

  const points: DailyCpaPoint[] = [];
  // Etapa 100: percorre as datas como texto (YYYY-MM-DD), sem passar por fuso.
  // Antes convertia "meia-noite" pra Date e depois pra fuso de Brasília — no
  // servidor (UTC) isso recuava 1 dia e o dia de ontem ficava de fora.
  for (let d = since; d <= until; d = addDaysYmd(d, 1)) {
    const v = byDate.get(d) ?? { spend: 0, results: 0 };
    points.push({
      date: d,
      spend: v.spend,
      results: v.results,
      cpa: v.results > 0 && v.spend > 0 ? v.spend / v.results : null,
    });
  }
  return points;
}

// Etapa 48: o dia de HOJE não estava aparecendo (todo mundo com "—") — a
// quebra por dia (time_increment=1) pode simplesmente não trazer nenhuma
// linha pro dia ainda em andamento. Corrigido buscando hoje separado, com
// date_preset "today" (agregado, sem quebra por dia) — a mesma técnica já
// usada com sucesso no resto do Painel (Acompanhamento) — e sobrescrevendo
// o ponto de hoje no array com esse valor, sempre que houver dado.
function getAccountTodayCpa(
  token: string,
  actId: string,
  todayDate: string,
  excluded: Set<string>,
): Promise<DailyCpaPoint> {
  // Etapa 125: Evolução pede "hoje" duas vezes (dia a dia + mês) — junta numa chamada só (1 min).
  return memoMeta(`daily-today:${actId}:${todayDate}:${token.slice(-10)}`, 60_000, () =>
    fetchAccountTodayCpa(token, actId, todayDate, excluded),
  );
}

async function fetchAccountTodayCpa(
  token: string,
  actId: string,
  todayDate: string,
  excluded: Set<string>,
): Promise<DailyCpaPoint> {
  const id = actId.startsWith("act_") ? actId : `act_${actId}`;
  let spend = 0;
  let results = 0;
  try {
    const rows = await metaGetAll<Omit<DailyInsightRow, "date_start">>(token, `/${id}/insights`, {
      fields: "campaign_id,campaign_name,spend,results,actions",
      date_preset: "today",
      level: "campaign",
      limit: "500",
      use_unified_attribution_setting: "true",
    });
    for (const row of rows) {
      if (isVaga(row.campaign_name)) continue;
      if (row.campaign_id && excluded.has(row.campaign_id)) continue;
      const lr = leadResultOf(row.results, row.actions);
      if (isNonLeadResultType(lr.type)) continue;
      spend += row.spend ? Number(row.spend) : 0;
      const r = lr.value;
      if (r != null) results += r;
    }
  } catch (e) {
    console.error("daily-cpa today err", id, e);
  }
  return { date: todayDate, spend, results, cpa: results > 0 && spend > 0 ? spend / results : null };
}

// Etapa 48: CPA do mês atual, fixo (não muda com o período/dias exibidos) —
// mesmo agregado usado no Ritmo de Acompanhamento (date_preset "this_month"),
// só que aqui devolvido como um DailyCpaPoint pra reaproveitar a mesma célula
// colorida da tabela.
export async function getAccountsMonthCpa(
  token: string,
  accountIds: string[],
): Promise<Record<string, DailyCpaPoint>> {
  const out: Record<string, DailyCpaPoint> = {};
  // Etapa 125: dia 01 até ontem vem do backup diário (Supabase); a Meta só responde "hoje".
  const todayDate = spDate(new Date());
  const monthStart = `${todayDate.slice(0, 7)}-01`;
  const yesterday = addDaysYmd(todayDate, -1);
  const storedMonth = monthStart <= yesterday ? await closedDaysFor(accountIds, monthStart, yesterday) : new Map();
  await Promise.all(
    accountIds.map(async (actId) => {
      const id = actId.startsWith("act_") ? actId : `act_${actId}`;
      const excluded = await getExcludedCampaignIds(token, id);
      let spend = 0;
      let results = 0;
      if (monthStart > yesterday || hasAllClosedDays(storedMonth.get(normAccountId(actId)), monthStart, yesterday)) {
        const days = storedMonth.get(normAccountId(actId));
        if (days) for (const d of days.values()) { spend += d.cpaSpend; results += d.results; }
        const t = await getAccountTodayCpa(token, actId, todayDate, excluded);
        spend += t.spend;
        results += t.results;
        out[actId] = { date: "this_month", spend, results, cpa: results > 0 && spend > 0 ? spend / results : null };
        return;
      }
      try {
        const rows = await metaGetAll<Omit<DailyInsightRow, "date_start">>(token, `/${id}/insights`, {
          fields: "campaign_id,campaign_name,spend,results,actions",
          date_preset: "this_month",
          level: "campaign",
          limit: "500",
          use_unified_attribution_setting: "true",
        });
        for (const row of rows) {
          if (isVaga(row.campaign_name)) continue;
          if (row.campaign_id && excluded.has(row.campaign_id)) continue;
          const lr = leadResultOf(row.results, row.actions);
      if (isNonLeadResultType(lr.type)) continue;
          spend += row.spend ? Number(row.spend) : 0;
          const r = lr.value;
          if (r != null) results += r;
        }
      } catch (e) {
        console.error("daily-cpa month err", id, e);
      }
      out[actId] = {
        date: "this_month",
        spend,
        results,
        cpa: results > 0 && spend > 0 ? spend / results : null,
      };
    }),
  );
  return out;
}

export async function getAccountsDailyCpa(
  token: string,
  accountIds: string[],
  days: number,
  includeToday = false,
): Promise<Record<string, DailyCpaPoint[]>> {
  const clampedDays = Math.max(1, Math.min(31, Math.floor(days) || 1));
  const now = new Date();
  const todayDate = spDate(now);
  const until = spDate(includeToday ? now : new Date(now.getTime() - 86_400_000));
  const since = addDaysYmd(until, -(clampedDays - 1));

  const out: Record<string, DailyCpaPoint[]> = {};
  // Etapa 125: dias fechados do período vêm do backup diário (Supabase) quando a conta tem todos eles;
  // senão, a busca de sempre na Meta. Hoje (includeToday) continua ao vivo.
  const closedUntil = until < todayDate ? until : addDaysYmd(todayDate, -1);
  const stored = since <= closedUntil ? await closedDaysFor(accountIds, since, closedUntil) : new Map();
  await Promise.all(
    accountIds.map(async (actId) => {
      const id = actId.startsWith("act_") ? actId : `act_${actId}`;
      const excluded = await getExcludedCampaignIds(token, id);
      const days = stored.get(normAccountId(actId));
      let points: DailyCpaPoint[];
      if (since <= closedUntil && hasAllClosedDays(days, since, closedUntil)) {
        points = [];
        for (let d = since; d <= closedUntil; d = addDaysYmd(d, 1)) {
          const v = days!.get(d)!;
          points.push({ date: d, spend: v.cpaSpend, results: v.results, cpa: v.results > 0 && v.cpaSpend > 0 ? v.cpaSpend / v.results : null });
        }
        if (until >= todayDate) points.push({ date: todayDate, spend: 0, results: 0, cpa: null });
      } else {
        points = await getAccountDailyCpa(token, actId, since, until, excluded);
      }
      if (includeToday) {
        const today = await getAccountTodayCpa(token, actId, todayDate, excluded);
        const idx = points.findIndex((p) => p.date === todayDate);
        if (today.spend > 0 || today.results > 0) {
          if (idx >= 0) points[idx] = today;
          else points.push(today);
        }
      }
      out[actId] = points;
    }),
  );
  return out;
}
