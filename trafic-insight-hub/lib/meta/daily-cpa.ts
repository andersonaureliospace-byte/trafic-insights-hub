// CPA diário por conta — portado do app anterior (getAccountsDailyCpa em
// src/lib/meta.functions.ts). Usado pela atualização de status em massa
// (classifica a prioridade da conta pelo CPA dos últimos dias) e serve
// também de base para eventuais gráficos futuros.

import { metaGet, metaGetAll, spDate } from "./client";
import { isVaga, EXCLUDED_OBJECTIVES, pickFirstNumeric } from "./shared";

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
  results?: Array<{ values?: Array<{ value?: string }> }>;
}

async function getExcludedCampaignIds(token: string, id: string): Promise<Set<string>> {
  const excluded = new Set<string>();
  try {
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
  } catch (e) {
    console.error("daily-cpa campaigns err", id, e);
  }
  return excluded;
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
      fields: "date_start,campaign_id,campaign_name,spend,results",
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
      const cur = byDate.get(row.date_start) ?? { spend: 0, results: 0 };
      cur.spend += row.spend ? Number(row.spend) : 0;
      const r = pickFirstNumeric(row.results);
      if (r != null) cur.results += r;
      byDate.set(row.date_start, cur);
    }
  } catch (e) {
    console.error("daily-cpa insights err", id, e);
  }

  const points: DailyCpaPoint[] = [];
  const sinceMs = new Date(`${since}T00:00:00`).getTime();
  const untilMs = new Date(`${until}T00:00:00`).getTime();
  for (let t = sinceMs; t <= untilMs; t += 86_400_000) {
    const d = spDate(new Date(t));
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
async function getAccountTodayCpa(
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
      fields: "campaign_id,campaign_name,spend,results",
      date_preset: "today",
      level: "campaign",
      limit: "500",
      use_unified_attribution_setting: "true",
    });
    for (const row of rows) {
      if (isVaga(row.campaign_name)) continue;
      if (row.campaign_id && excluded.has(row.campaign_id)) continue;
      spend += row.spend ? Number(row.spend) : 0;
      const r = pickFirstNumeric(row.results);
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
  await Promise.all(
    accountIds.map(async (actId) => {
      const id = actId.startsWith("act_") ? actId : `act_${actId}`;
      const excluded = await getExcludedCampaignIds(token, id);
      let spend = 0;
      let results = 0;
      try {
        const rows = await metaGetAll<Omit<DailyInsightRow, "date_start">>(token, `/${id}/insights`, {
          fields: "campaign_id,campaign_name,spend,results",
          date_preset: "this_month",
          level: "campaign",
          limit: "500",
          use_unified_attribution_setting: "true",
        });
        for (const row of rows) {
          if (isVaga(row.campaign_name)) continue;
          if (row.campaign_id && excluded.has(row.campaign_id)) continue;
          spend += row.spend ? Number(row.spend) : 0;
          const r = pickFirstNumeric(row.results);
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
  const untilMs = new Date(`${until}T00:00:00`).getTime();
  const since = spDate(new Date(untilMs - (clampedDays - 1) * 86_400_000));

  const out: Record<string, DailyCpaPoint[]> = {};
  await Promise.all(
    accountIds.map(async (actId) => {
      const id = actId.startsWith("act_") ? actId : `act_${actId}`;
      const excluded = await getExcludedCampaignIds(token, id);
      const points = await getAccountDailyCpa(token, actId, since, until, excluded);
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
