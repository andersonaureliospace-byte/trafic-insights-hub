// Contas e métricas — portado do app anterior (getAdAccounts / getAccountsInsights
// em src/lib/meta.functions.ts), mesma regra de negócio:
//  - ignora campanhas "[VAGA]"/"[SEGUIDORES]" (vagas de emprego disfarçadas de campanha)
//  - campanhas de objetivo de reconhecimento/tráfego/visitas ao perfil/
//    engajamento (EXCLUDED_OBJECTIVES) entram SÓ no investimento (spend e
//    orçamento diário) — nunca em resultado, CPA nem custo por resultado (desde
//    a Etapa 84, a pedido; antes eram ignoradas por completo). O mesmo vale
//    pra campanha com [SEGUIDORES]/[TRÁFEGO] no nome (isVaga): investimento
//    conta, resultado/CPA não. SÓ [VAGA] (isJobCampaign) fica fora de tudo.
//  - só soma campanha/conjunto que tenha ao menos um anúncio "ligado" (ver
//    ATIVE_ISH_STATUSES abaixo — inclui "Programado", que também conta pro
//    Invest. diário mesmo sem estar entregando ainda)
//  - "resultado"/CPA vem do campo oficial `results` / `cost_per_result` do
//    Graph API — a mesma fonte que o Gerenciador de Anúncios usa, sem inflar
//    com `actions`
//  - orçamento diário soma CBO da campanha, ou (se não tiver CBO) o orçamento
//    dos conjuntos ativos, convertendo lifetime_budget pro equivalente diário

import { metaGet, metaGetAll, presetParams, type DateRangeInput } from "./client";
import { isVaga, isJobCampaign, EXCLUDED_OBJECTIVES, pickFirstNumeric, lifetimeToDailyEquivalent } from "./shared";

// Ajuste pedido pelo usuário: um conjunto "Programado" (Meta Ads mostra o
// círculo vazado "○ Programado" em vez da bolinha verde "● Ativo") tem o
// toggle ligado (status ACTIVE) mas ainda não começou a entregar — por
// horário de início futuro, ou por revisão/análise de conta ainda em
// andamento. O `effective_status` do Graph API reflete esse "ainda não
// entregando" e por padrão SÓ "ACTIVE" passava no filtro, deixando
// Programado de fora do Invest. diário. Esses status aqui são os "ligado,
// mas ainda não entregando por motivo temporário" — contam igual a ACTIVE.
// DISAPPROVED/PAUSED/CAMPAIGN_PAUSED/ADSET_PAUSED/ARCHIVED/DELETED ficam de
// fora de propósito (não vão gastar enquanto isso, diferente de Programado).
const ACTIVE_ISH_STATUSES = [
  "ACTIVE",
  "PENDING_REVIEW",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
  "WITH_ISSUES",
];

// Etapa 88: data de término (end_time de conjunto / stop_time de campanha) já
// passou? Sem data (ou "0"/inválida) = sem término, nunca concluído.
function hasEnded(t?: string): boolean {
  if (!t) return false;
  const ms = Date.parse(t);
  return Number.isFinite(ms) && ms < Date.now();
}

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
  // Business Manager dono da conta — pedido junto com a listagem de contas
  // (sem chamada extra), usado no link de Cobranças e Pagamentos.
  business?: { id: string; name?: string } | null;
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
  // Etapa 89: true quando a busca de gasto/resultado (insights) da conta falhou
  // (ex.: limite de requisições da Meta) — nesse caso spend/CPA vieram zerados
  // por falta de dado, não porque a conta não gastou. Quem usa o spend (Ritmo,
  // aviso de investimento baixo) precisa tratar como "sem dado".
  insights_failed?: boolean;
}

export async function getAdAccounts(token: string): Promise<AdAccount[]> {
  const data = await metaGet<{ data: AdAccount[] }>(token, "/me/adaccounts", {
    fields: "id,account_id,name,account_status,disable_reason,balance,currency,amount_spent,spend_cap,business{id,name}",
    limit: "200",
  });
  return data.data ?? [];
}

// Tipo de pagamento (pré-paga/pós-paga) direto da Meta — de propósito FORA
// da listagem de contas de sempre (getAdAccounts, chamada a cada carregamento
// do Painel): isso só precisa ser puxado uma única vez por conta, na
// primeira vez que ela aparece em Controle de Saldo sem tipo salvo ainda
// (ver ControleSaldo). is_prepay_account exige acesso de admin na conta;
// sem esse nível o Graph API simplesmente não retorna o campo, e a conta
// fica null (Controle de Saldo deixa em branco pra escolha manual).
export async function getIsPrepayAccounts(
  token: string,
  accountIds: string[],
): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  await Promise.all(
    accountIds.map(async (actId) => {
      const id = actId.startsWith("act_") ? actId : `act_${actId}`;
      try {
        const data = await metaGet<{ is_prepay_account?: boolean }>(token, `/${id}`, {
          fields: "is_prepay_account",
        });
        out[actId] = typeof data.is_prepay_account === "boolean" ? data.is_prepay_account : null;
      } catch {
        out[actId] = null;
      }
    }),
  );
  return out;
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

  let spend = 0; // investimento total: tudo, menos [VAGA] (inclui reconhecimento/tráfego)
  // Gasto só das campanhas que contam pra resultado/CPA (fora os objetivos de
  // EXCLUDED_OBJECTIVES) — é o numerador do custo por resultado.
  let cpaSpend = 0;
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
        filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ACTIVE_ISH_STATUSES }]),
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
      if (isJobCampaign(c.name)) {
        if (c.id) vagaIds.add(c.id);
        continue;
      }
      // Etapa 84: [SEGUIDORES]/[TRÁFEGO] no nome conta no investimento (gasto e
      // orçamento diário), só fica fora de resultado/CPA — igual aos objetivos.
      if (c.id && isVaga(c.name)) excludedIds.add(c.id);
      // Etapa 84: objetivo "fora do CPA" não pula mais a conta de orçamento
      // diário — o investimento delas conta (só o resultado/CPA não).
      if (c.id && c.objective && EXCLUDED_OBJECTIVES.has(c.objective)) excludedIds.add(c.id);
      const isActive = c.effective_status === "ACTIVE" || c.status === "ACTIVE";
      if (!isActive) continue;
      // Etapa 88: campanha com data de término já passada = "Concluída" no
      // Gerenciador, mesmo com a chavinha ligada e o effective_status ainda ACTIVE.
      if (hasEnded(c.stop_time)) continue;
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
        filtering: JSON.stringify([{ field: "adset.effective_status", operator: "IN", value: ACTIVE_ISH_STATUSES }]),
      });
      for (const a of adsets) {
        if (!a.campaign_id) continue;
        if (!activeNoCboIds.has(a.campaign_id)) continue;
        if (!a.id || !adsetsWithActiveAd.has(a.id)) continue;
        // Etapa 88: conjunto com data de término já passada aparece como
        // "Concluído" no Gerenciador (chavinha ligada, mas sem entregar) — o
        // Graph API continua devolvendo effective_status ACTIVE, então checa a data.
        if (hasEnded(a.end_time)) continue;
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
  let insightsFailed = false;
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
      if (isJobCampaign(row.campaign_name)) continue;
      if (row.campaign_id && vagaIds.has(row.campaign_id)) continue;
      const rowSpend = row.spend ? Number(row.spend) : 0;
      // Etapa 84: campanha de objetivo excluído soma no investimento e para aqui
      // — não entra em cpaSpend, resultado nem tipo de resultado.
      spend += rowSpend;
      if (isVaga(row.campaign_name)) continue; // tag de nome (seguidores/tráfego): fora do CPA
      if (row.campaign_id && excludedIds.has(row.campaign_id)) continue;
      cpaSpend += rowSpend;
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
      if (cpaSpend > 0) costPerResult = cpaSpend / totalResults;
    }
  } catch (e) {
    console.error("insights err", id, e);
    insightsFailed = true;
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
    insights_failed: insightsFailed || undefined,
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
  // Etapa 89: contas cuja busca falhou (tipicamente limite de requisições da
  // Meta com muitas contas em paralelo) são tentadas de novo, uma de cada vez e
  // com uma pausa, até 2 rodadas — em vez de ficarem com gasto zerado.
  for (let round = 0; round < 2; round++) {
    const failed = accountIds.filter((id) => out[id]?.insights_failed);
    if (failed.length === 0) break;
    await new Promise((r) => setTimeout(r, 1500));
    for (const actId of failed) {
      out[actId] = await getAccountInsight(token, actId, datePreset);
    }
  }
  return out;
}
