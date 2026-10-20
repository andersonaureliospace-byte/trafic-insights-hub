// Melhor público (Etapas 164 e 167): leitura da Meta por conta. Insights por CONJUNTO com quebra de faixa etária + gênero em 3 janelas de dias FECHADOS
// (7, 14 e 30 — todas terminam ontem). O tipo vem do NOME do conjunto (GERAL ou EXAME; PROMO e boleto/crediário ficam de fora, campanhas [VAGA]/[TRÁFEGO] também).
// Resultado = conversas iniciadas (mesma regra da Análise). Só LÊ da Meta.

import { metaGetAll, presetParams } from "./client";
import { addDaysYmd, todayBrt } from "./daily-range";
import { isVaga, EXCLUDED_OBJECTIVES } from "./shared";
import { parseAdsetName } from "@/lib/offers/rule";
import { WINDOWS, type AudGender, type AudRow, type AudType } from "./audience-summary";

type ActionRow = { action_type?: string; value?: string };
interface InsightRow {
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  age?: string;
  gender?: string;
  spend?: string;
  actions?: ActionRow[];
}

export function audienceRange(days: number, now: Date = new Date()) {
  const until = addDaysYmd(todayBrt(now), -1);
  return { since: addDaysYmd(until, -(days - 1)), until };
}

// Uma conta, as 3 janelas (7, 14 e 30 dias). Chaves: "7", "14", "30".
export async function getAccountAudience(token: string, accountId: string, now: Date = new Date()): Promise<Record<string, AudRow[]>> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const [campaigns, ...perWindow] = await Promise.all([
    metaGetAll<{ id?: string; objective?: string }>(token, `/${id}/campaigns`, { fields: "id,objective", limit: "500" }).catch(() => []),
    ...WINDOWS.map((days) =>
      metaGetAll<InsightRow>(
        token,
        `/${id}/insights`,
        {
          fields: "adset_name,campaign_id,campaign_name,spend,actions",
          ...presetParams(audienceRange(days, now)),
          level: "adset",
          breakdowns: "age,gender",
          limit: "500",
          use_unified_attribution_setting: "true",
        },
        12,
      ),
    ),
  ]);
  const excluded = new Set<string>();
  for (const c of campaigns) if (c.id && c.objective && EXCLUDED_OBJECTIVES.has(c.objective)) excluded.add(c.id);
  const out: Record<string, AudRow[]> = {};
  WINDOWS.forEach((days, i) => {
    out[String(days)] = aggregate(perWindow[i], excluded);
  });
  return out;
}

function aggregate(rows: InsightRow[], excluded: Set<string>): AudRow[] {
  const agg = new Map<string, AudRow>();
  for (const r of rows) {
    if (!r.age || isVaga(r.campaign_name)) continue;
    if (r.campaign_id && excluded.has(r.campaign_id)) continue;
    const p = parseAdsetName(r.adset_name ?? "");
    if (!p || p.payment || (p.type !== "GERAL" && p.type !== "EXAME")) continue;
    const spend = Number(r.spend) || 0;
    const conv = Number((r.actions ?? []).find((a) => a.action_type?.includes("messaging_conversation_started"))?.value) || 0;
    if (spend <= 0 && conv <= 0) continue;
    const gender: AudGender = r.gender === "female" ? "female" : r.gender === "male" ? "male" : "unknown";
    const type = p.type as AudType;
    const k = `${type}|${r.age}|${gender}`;
    const cur = agg.get(k);
    if (cur) {
      cur.spend += spend;
      cur.conv += conv;
    } else agg.set(k, { type, age: r.age, gender, spend, conv });
  }
  return [...agg.values()];
}
