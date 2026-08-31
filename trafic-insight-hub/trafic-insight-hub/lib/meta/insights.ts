// Contas e métricas — portado do app anterior (getAdAccounts / getAccountsInsights
// em src/lib/meta.functions.ts), mesma regra de negócio:
//  - ignora campanhas "[VAGA]"/"[SEGUIDORES]" (vagas de emprego disfarçadas de campanha)
//  - ignora campanhas de objetivo de reconhecimento/tráfego/engajamento (não é o
//    tipo de resultado que o gestor acompanha aqui)
//  - só soma campanha/conjunto que tenha ao menos um anúncio ATIVO entregando
//  - "resultado"/CPA vem do campo oficial `results` / `cost_per_result` do
//    Graph API — a mesma fonte que o Gerenciador de Anúncios usa, sem inflar
//    com `actions`
//  - orçamento diário soma CBO da campanha, ou (se não tiver CBO) o orçamento
//    dos conjuntos ativos, convertendo lifetime_budget pro equivalente diário

import { metaGet, metaGetAll, presetParams, type DateRangeInput } from "./client";
import { isVaga, EXCLUDED_OBJECTIVES, pickFirstNumeric, lifetimeToDailyEquivalent } from "./shared";

export interface AdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status: number;
  balance: string;
  currency: string;
  amount_spent: string;
  spend_cap?: string;
  disable_reason?: number;
}

export interface AccountInsight {
  account_id: string;
  spend: number;
  cost_per_result: number | null;
  results: number | null;
  daily_budget: number;
  cbo_budget: number;
  result_type: string | null;
  result_types_count: number;
}

export async function getAdAccounts(token: string): Promise<AdAccount[]> {
  const data = await metaGet<{ data: AdAccount[] }>(token, "/me/adaccounts", {
    fields: "id,account_id,name,account_status,disable_reason,balance,currency,amount_spent,spend_cap",
    limit: "200",
  });
  return data.data ?? [];
}

interface CampaignRow {
  id?: string;
  name?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  status?: string;
  effective_status?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
}

export async function getAccountInsight(
  token: string,
  actId: string,
  datePreset: DateRangeInput,
): Promise<AccountInsight> {
  const id = actId.startsWith("act_") ? actId : `act_${actId}`;

  let spend = 0;
  let costPerResult: number | null = null;
  let results: number | null = null;

  const vagaIds = new Set<string>();
  const activeNoCboIds = new Set<string>();
  let dailyBudget = 0;
  let cboBudget = 0;
  const excludedIds = new Set<string>();

  const campaignsWithActiveAd = new Set<string>();
  const adsetsWithActiveAd = new Set<string>();
  try {
    const activeAds = await metaGetAll<{ campaign_id?: string; adset_id?: string }>(
      token,
      `/${id}/ads`,
      {
        fields: "campaign_id,adset_id",
        limit: "500",
        filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
      },
    );
    for (const a of activeAds) {
      if (a.campaign_id) campaignsWithActiveAd.add(a.campaign_id);
      if (a.adset_id) adsetsWithActiveAd.add(a.adset_id);
    }
  } catch (e) {
    console.error("active ads err", id, e);
  }

  try {
    const camps = await metaGet<{ data: CampaignRow[] }>(token, `/${id}/campaigns`, {
      fields:
        "id,name,objective,daily_budget,lifetime_budget,status,effective_status,start_time,stop_time,created_time",
      limit: "500",
    });
    for (const c of camps.data ?? []) {
      if (isVaga(c.name)) {
        if (c.id) vagaIds.add(c.id);
        continue;
      }
      if (c.id && c.objective && EXCLUDED_OBJECTIVES.has(c.objective)) {
        excludedIds.add(c.id);
        continue;
      }
      const isActive = c.effective_status === "ACTIVE" || c.status === "ACTIVE";
      if (!isActive) continue;
      if (!c.id || !campaignsWithActiveAd.has(c.id)) continue;
      if (c.daily_budget) {
        const v = Number(c.daily_budget) / 100;
        dailyBudget += v;
        cboBudget += v;
      } else if (c.lifetime_budget) {
        const v = lifetimeToDailyEquivalent(c.lifetime_budget, c.start_time, c.stop_time, c.created_time);
        dailyBudget += v;
        cboBudget += v;
      } else if (c.id) {
        activeNoCboIds.add(c.id);
      }
    }
  } catch (e) {
    console.error("campaigns err", id, e);
  }

  if (activeNoCboIds.size > 0) {
    try {
      const adsets = await metaGetAll<{
        id?: string;
        campaign_id?: string;
        daily_budget?: string;
        lifetime_budget?: string;
        start_time?: string;
        end_time?: string;
        created_time?: string;
      }>(token, `/${id}/adsets`, {
        fields: "id,campaign_id,daily_budget,lifetime_budget,start_time,end_time,created_time",
        limit: "500",
        filtering: JSON.stringify([{ field: "adset.effective_status", operator: "IN", value: ["ACTIVE"] }]),
      });
      for (const a of adsets) {
        if (!a.campaign_id) continue;
        if (excludedIds.has(a.campaign_id)) continue;
        if (!activeNoCboIds.has(a.campaign_id)) continue;
        if (!a.id || !adsetsWithActiveAd.has(a.id)) continue;
        if (a.daily_budget) {
          dailyBudget += Number(a.daily_budget) / 100;
        } else if (a.lifetime_budget) {
          dailyBudget += lifetimeToDailyEquivalent(a.lifetime_budget, a.start_time, a.end_time, a.created_time);
        }
      }
    } catch (e) {
      console.error("adsets budget err", id, e);
    }
  }

  const resultTypesSet = new Set<string>();
  let lastResultType: string | null = null;
  try {
    const ins = await metaGet<{
      data: Array<{
        campaign_id?: string;
        campaign_name?: string;
        spend?: string;
        results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
        cost_per_result?: Array<{ values?: Array<{ value?: string }> }>;
      }>;
    }>(token, `/${id}/insights`, {
      fields: "campaign_id,campaign_name,spend,actions,cost_per_action_type,results,cost_per_result",
      ...presetParams(datePreset),
      level: "campaign",
      limit: "500",
      use_unified_attribution_setting: "true",
    });
    let totalResults = 0;
    let hasResults = false;
    for (const row of ins.data ?? []) {
      if (isVaga(row.campaign_name)) continue;
      if (row.campaign_id && vagaIds.has(row.campaign_id)) continue;
      if (row.campaign_id && excludedIds.has(row.campaign_id)) continue;
      const rowSpend = row.spend ? Number(row.spend) : 0;
      spend += rowSpend;
      const rowResults = pickFirstNumeric(row.results);
      let rowType: string | null = null;
      if (rowResults != null && rowResults > 0) {
        const ind = row.results?.[0]?.indicator;
        if (ind) rowType = ind.includes(":") ? ind.split(":").slice(1).join(":") : ind;
      }
      if (rowResults != null && rowResults > 0) {
        totalResults += rowResults;
        hasResults = true;
        if (rowType) {
          resultTypesSet.add(rowType);
          lastResultType = rowType;
        }
      }
    }
    if (hasResults) {
      results = totalResults;
      if (spend > 0) costPerResult = spend / totalResults;
    }
  } catch (e) {
    console.error("insights err", id, e);
  }

  return {
    account_id: actId,
    spend,
    cost_per_result: costPerResult,
    results,
    daily_budget: dailyBudget,
    cbo_budget: cboBudget,
    result_type: lastResultType,
    result_types_count: resultTypesSet.size,
  };
}

export async function getAccountsInsights(
  token: string,
  accountIds: string[],
  datePreset: DateRangeInput,
): Promise<Record<string, AccountInsight>> {
  const out: Record<string, AccountInsight> = {};
  await Promise.all(
    accountIds.map(async (actId) => {
      out[actId] = await getAccountInsight(token, actId, datePreset);
    }),
  );
  return out;
}
