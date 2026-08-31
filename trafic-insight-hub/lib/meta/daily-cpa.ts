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

async function getAccountDailyCpa(
  token: string,
  actId: string,
  since: string,
  until: string,
): Promise<DailyCpaPoint[]> {
  const id = actId.startsWith("act_") ? actId : `act_${actId}`;

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

export async function getAccountsDailyCpa(
  token: string,
  accountIds: string[],
  days: number,
  includeToday = false,
): Promise<Record<string, DailyCpaPoint[]>> {
  const clampedDays = Math.max(1, Math.min(31, Math.floor(days) || 1));
  const now = new Date();
  const until = spDate(includeToday ? now : new Date(now.getTime() - 86_400_000));
  const untilMs = new Date(`${until}T00:00:00`).getTime();
  const since = spDate(new Date(untilMs - (clampedDays - 1) * 86_400_000));

  const out: Record<string, DailyCpaPoint[]> = {};
  await Promise.all(
    accountIds.map(async (actId) => {
      out[actId] = await getAccountDailyCpa(token, actId, since, until);
    }),
  );
  return out;
}
