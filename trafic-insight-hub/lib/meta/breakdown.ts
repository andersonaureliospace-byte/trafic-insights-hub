// Visão Geral por Campanhas / Conjuntos / Anúncios — portado de
// getAccountBreakdown em src/lib/meta.functions.ts do app anterior.
// Mesmas regras: orçamento diário só conta pra quem está entregando de
// verdade (tem filho ativo), resultado vem do campo oficial `results`,
// linhas mortas (sem gasto/impressão/resultado no período) são ocultadas,
// e no nível anúncio verificamos se a Página do criativo ainda está
// acessível (permissão pode cair sem avisar).

import { metaGet, metaGetAll, presetParams, type DateRangeInput } from "./client";
import { isVaga, pickFirstNumeric, lifetimeToDailyEquivalent, checkPageAdsAccess, extractAdPageId } from "./shared";

export type BreakdownLevel = "campaign" | "adset" | "ad";

export interface BreakdownRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  results: number | null;
  result_type: string | null;
  cost_per_result: number | null;
  daily_budget: number | null;
  status: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  campaign_status?: string | null;
  campaign_objective?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  adset_status?: string | null;
  page_id?: string | null;
  page_access_ok?: boolean | null;
}

type ActionRow = { action_type?: string; value?: string };

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  actions?: ActionRow[];
  cost_per_action_type?: ActionRow[];
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  cost_per_result?: Array<{ values?: Array<{ value?: string }> }>;
}
interface CampRow {
  id?: string;
  name?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  status?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
}
interface AdsetRow {
  id?: string;
  name?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  created_time?: string;
}
interface AdRow {
  id?: string;
  name?: string;
  adset_id?: string;
  effective_status?: string;
  status?: string;
  creative?: {
    object_story_spec?: { page_id?: string };
    effective_object_story_id?: string;
  };
}

const isActive = (s?: string) => (s || "").toUpperCase() === "ACTIVE";

export async function getAccountBreakdown(
  token: string,
  accountId: string,
  datePreset: DateRangeInput,
  level: BreakdownLevel,
): Promise<{ rows: BreakdownRow[]; total_active_budget: number | null }> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

  const insightsP = metaGetAll<InsightRow>(token, `/${id}/insights`, {
    fields:
      "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,actions,cost_per_action_type,results,cost_per_result",
    ...presetParams(datePreset),
    level,
    limit: "500",
    use_unified_attribution_setting: "true",
  });
  const campsP = metaGetAll<CampRow>(token, `/${id}/campaigns`, {
    fields: "id,name,objective,daily_budget,lifetime_budget,effective_status,status,start_time,stop_time,created_time",
    limit: "500",
  }).catch((e) => {
    console.error("breakdown campaigns err (non-fatal)", id, e);
    return [] as CampRow[];
  });
  const adsetsP = metaGetAll<AdsetRow>(token, `/${id}/adsets`, {
    fields: "id,name,campaign_id,daily_budget,lifetime_budget,effective_status,status,start_time,end_time,created_time",
    limit: "500",
  }).catch((e) => {
    console.error("breakdown adsets err (non-fatal)", id, e);
    return [] as AdsetRow[];
  });
  const adsP = metaGetAll<AdRow>(token, `/${id}/ads`, {
    fields:
      level === "ad"
        ? "id,name,adset_id,effective_status,status,creative{object_story_spec,effective_object_story_id}"
        : "id,adset_id,effective_status,status",
    limit: "500",
  }).catch((e) => {
    console.error("breakdown ads err (non-fatal)", id, e);
    return [] as AdRow[];
  });

  let insRows: InsightRow[];
  let camps: CampRow[];
  let adsets: AdsetRow[];
  let ads: AdRow[];
  try {
    [insRows, camps, adsets, ads] = await Promise.all([insightsP, campsP, adsetsP, adsP]);
  } catch (e) {
    throw new Error(`Falha ao buscar insights da conta: ${(e as Error).message}`);
  }

  const campaignNames = new Map<string, string>();
  const campaignBudget = new Map<string, number>();
  const campaignStatus = new Map<string, string>();
  const campaignObjective = new Map<string, string>();
  const adsetBudget = new Map<string, number>();
  const adsetNames = new Map<string, string>();
  const adsetStatus = new Map<string, string>();
  const adsetCampaign = new Map<string, string>();
  const statusMap = new Map<string, string>();

  const activeCampaignsWithCbo = new Map<string, number>();
  const activeCampaignsNoCbo = new Set<string>();

  for (const c of camps) {
    if (!c.id) continue;
    if (c.name) campaignNames.set(c.id, c.name);
    if (c.objective) campaignObjective.set(c.id, c.objective);
    let cDaily: number | null = null;
    if (c.daily_budget) {
      cDaily = Number(c.daily_budget) / 100;
    } else if (c.lifetime_budget) {
      const v = lifetimeToDailyEquivalent(c.lifetime_budget, c.start_time, c.stop_time, c.created_time);
      if (v > 0) cDaily = v;
    }
    if (cDaily != null) campaignBudget.set(c.id, cDaily);
    const eff = c.effective_status || c.status || "";
    if (eff) campaignStatus.set(c.id, eff);
    if (level === "campaign") statusMap.set(c.id, eff);
    if (isActive(c.effective_status) && !isVaga(c.name)) {
      if (cDaily != null) activeCampaignsWithCbo.set(c.id, cDaily);
      else activeCampaignsNoCbo.add(c.id);
    }
  }

  for (const a of adsets) {
    if (!a.id) continue;
    if (a.name) adsetNames.set(a.id, a.name);
    if (a.campaign_id) adsetCampaign.set(a.id, a.campaign_id);
    const eff = a.effective_status || a.status || "";
    if (eff) adsetStatus.set(a.id, eff);
    let v: number | null = null;
    if (a.daily_budget) {
      v = Number(a.daily_budget) / 100;
    } else if (a.lifetime_budget) {
      const eq = lifetimeToDailyEquivalent(a.lifetime_budget, a.start_time, a.end_time, a.created_time);
      if (eq > 0) v = eq;
    }
    if (v != null) adsetBudget.set(a.id, v);
    if (level === "adset") statusMap.set(a.id, eff);
  }

  const adsetsWithActiveAd = new Set<string>();
  const adPageId = new Map<string, string | null>();
  const adName = new Map<string, string>();
  const adAdsetId = new Map<string, string>();
  for (const a of ads) {
    if (!a.id) continue;
    if (level === "ad") {
      statusMap.set(a.id, a.effective_status || a.status || "");
      adPageId.set(a.id, extractAdPageId(a));
      if (a.name) adName.set(a.id, a.name);
      if (a.adset_id) adAdsetId.set(a.id, a.adset_id);
    }
    if (a.adset_id && isActive(a.effective_status)) adsetsWithActiveAd.add(a.adset_id);
  }

  const pageAccessMap = new Map<string, boolean | null>();
  if (level === "ad") {
    const distinctPages = new Set<string>();
    for (const pid of adPageId.values()) if (pid) distinctPages.add(pid);
    const checks = await Promise.all(
      Array.from(distinctPages).map(async (pid) => [pid, await checkPageAdsAccess(metaGet, token, pid)] as const),
    );
    for (const [pid, ok] of checks) pageAccessMap.set(pid, ok);
  }

  const deliveringAdsetSumPerCampaign = new Map<string, number>();
  for (const [aid, v] of adsetBudget.entries()) {
    if (!isActive(adsetStatus.get(aid))) continue;
    if (!adsetsWithActiveAd.has(aid)) continue;
    const cid = adsetCampaign.get(aid);
    if (cid) deliveringAdsetSumPerCampaign.set(cid, (deliveringAdsetSumPerCampaign.get(cid) ?? 0) + v);
  }
  const campaignsWithDeliveringChild = new Set<string>();
  for (const aid of adsetsWithActiveAd) {
    if (!isActive(adsetStatus.get(aid))) continue;
    const cid = adsetCampaign.get(aid);
    if (cid) campaignsWithDeliveringChild.add(cid);
  }

  let totalActiveBudget = 0;
  for (const [cid, v] of activeCampaignsWithCbo.entries()) {
    if (campaignsWithDeliveringChild.has(cid)) totalActiveBudget += v;
  }
  for (const cid of activeCampaignsNoCbo) {
    totalActiveBudget += deliveringAdsetSumPerCampaign.get(cid) ?? 0;
  }

  const rows: BreakdownRow[] = [];
  for (const row of insRows) {
    let rowId: string | undefined;
    let rowName: string | undefined;
    if (level === "campaign") {
      rowId = row.campaign_id;
      rowName = row.campaign_name;
    } else if (level === "adset") {
      rowId = row.adset_id;
      rowName = row.adset_name;
    } else {
      rowId = row.ad_id;
      rowName = row.ad_name;
    }
    if (!rowId) continue;
    if (isVaga(row.campaign_name)) continue;

    const spend = row.spend ? Number(row.spend) : 0;
    const impressions = row.impressions ? Number(row.impressions) : 0;
    const results = pickFirstNumeric(row.results);
    let result_type: string | null = null;
    if (results != null && results > 0) {
      const ind = row.results?.[0]?.indicator;
      if (ind) result_type = ind.includes(":") ? ind.split(":").slice(1).join(":") : ind;
    }

    // No nível campanha, só mostra quem teve impressão de verdade no
    // período (pedido explícito) — nos outros níveis mantém o critério mais
    // largo de antes (gasto ou resultado também contam), pra não sumir
    // conjunto/anúncio com dado relevante mas sem impressão registrada.
    const hadActivity =
      level === "campaign" ? impressions >= 1 : spend > 0 || impressions >= 1 || (results ?? 0) >= 1;
    if (!hadActivity) continue;

    const cost_per_result = results != null && results > 0 && spend > 0 ? spend / results : null;
    let daily_budget: number | null = null;
    if (level === "campaign") {
      const cbo = campaignBudget.get(rowId) ?? null;
      const delivers = campaignsWithDeliveringChild.has(rowId);
      daily_budget = cbo != null ? (delivers ? cbo : null) : deliveringAdsetSumPerCampaign.get(rowId) ?? null;
    } else if (level === "adset") {
      if (isActive(adsetStatus.get(rowId)) && adsetsWithActiveAd.has(rowId)) {
        daily_budget = adsetBudget.get(rowId) ?? null;
      }
    }
    const adsetIdForRow = level === "adset" ? rowId : level === "ad" ? row.adset_id ?? null : null;
    const campaignIdForRow =
      level === "campaign" ? rowId : row.campaign_id ?? (adsetIdForRow ? adsetCampaign.get(adsetIdForRow) ?? null : null);

    rows.push({
      id: rowId,
      name: rowName || campaignNames.get(rowId) || rowId,
      spend,
      impressions,
      results,
      result_type,
      cost_per_result,
      daily_budget,
      status: statusMap.get(rowId) || null,
      campaign_id: campaignIdForRow,
      campaign_name: row.campaign_name ?? (campaignIdForRow ? campaignNames.get(campaignIdForRow) ?? null : null),
      campaign_status: campaignIdForRow ? campaignStatus.get(campaignIdForRow) ?? null : null,
      campaign_objective: campaignIdForRow ? campaignObjective.get(campaignIdForRow) ?? null : null,
      adset_id: adsetIdForRow,
      adset_name:
        level === "ad"
          ? row.adset_name ?? (adsetIdForRow ? adsetNames.get(adsetIdForRow) ?? null : null)
          : level === "adset"
            ? rowName ?? null
            : null,
      adset_status: adsetIdForRow ? adsetStatus.get(adsetIdForRow) ?? null : null,
      page_id: level === "ad" ? adPageId.get(rowId) ?? null : null,
      page_access_ok:
        level === "ad"
          ? (() => {
              const pid = adPageId.get(rowId);
              return pid ? pageAccessMap.get(pid) ?? null : null;
            })()
          : null,
    });
  }

  // No nível anúncio, inclui anúncios ATIVOS sem impressão ainda (recém-publicados).
  if (level === "ad") {
    const present = new Set(rows.map((r) => r.id));
    for (const a of ads) {
      if (!a.id || present.has(a.id)) continue;
      if (!isActive(a.effective_status)) continue;
      const adsetIdForRow = a.adset_id ?? adAdsetId.get(a.id) ?? null;
      const campaignIdForRow = adsetIdForRow ? adsetCampaign.get(adsetIdForRow) ?? null : null;
      const campName = campaignIdForRow ? campaignNames.get(campaignIdForRow) ?? null : null;
      if (campName && isVaga(campName)) continue;
      const pid = adPageId.get(a.id) ?? null;
      rows.push({
        id: a.id,
        name: adName.get(a.id) || a.id,
        spend: 0,
        impressions: 0,
        results: null,
        result_type: null,
        cost_per_result: null,
        daily_budget: null,
        status: a.effective_status || a.status || null,
        campaign_id: campaignIdForRow,
        campaign_name: campName,
        campaign_status: campaignIdForRow ? campaignStatus.get(campaignIdForRow) ?? null : null,
        campaign_objective: campaignIdForRow ? campaignObjective.get(campaignIdForRow) ?? null : null,
        adset_id: adsetIdForRow,
        adset_name: adsetIdForRow ? adsetNames.get(adsetIdForRow) ?? null : null,
        adset_status: adsetIdForRow ? adsetStatus.get(adsetIdForRow) ?? null : null,
        page_id: pid,
        page_access_ok: pid ? pageAccessMap.get(pid) ?? null : null,
      });
    }
  }

  const statusRank = (s: string | null) => {
    const v = (s || "").toUpperCase();
    if (v === "ACTIVE") return 0;
    if (v === "PAUSED") return 1;
    return 2;
  };
  rows.sort((a, b) => {
    const sa = statusRank(a.status);
    const sb = statusRank(b.status);
    if (sa !== sb) return sa - sb;
    return (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base", numeric: true });
  });

  return { rows, total_active_budget: totalActiveBudget };
}
