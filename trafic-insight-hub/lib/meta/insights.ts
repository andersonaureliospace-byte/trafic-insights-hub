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
//  - "resultado" vem do campo oficial `results` do Graph API — a mesma fonte
//    que o Gerenciador de Anúncios usa, sem inflar com `actions`
//  - Etapa 185 (regra da Speed, conferida na Meta): CPA = investimento TOTAL
//    (tudo menos [VAGA], inclusive tráfego/visitas ao perfil) ÷ conversas.
//    Antes o numerador era só o gasto das campanhas que contam pra resultado,
//    o que deixava o CPA mais baixo que o da Speed em conta com campanha de
//    outro objetivo rodando (ex.: Novo Hamburgo R$ 5,46 aqui × R$ 6,15 na Speed)
//  - orçamento diário soma CBO da campanha, ou (se não tiver CBO) o orçamento
//    dos conjuntos ativos, convertendo lifetime_budget pro equivalente diário

import { metaGet, metaGetAll, presetParams, type DateRangeInput } from "./client";
import { memoMeta, tokenTag } from "./memo";
import { planFromStore } from "./daily-store";
import { isVaga, isJobCampaign, EXCLUDED_OBJECTIVES, lifetimeToDailyEquivalent, isNonLeadResultType, leadResultOf } from "./shared";

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
export const ACTIVE_ISH_STATUSES = [
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
  // Etapa 191: true quando alguma chamada de orçamento (anúncios ativos, campanhas, conjuntos) falhou — aí
  // daily_budget pode ter vindo 0 ou faltando pedaço (não confiável). Antes isso aparecia como "0,00" no Ritmo.
  budget_failed?: boolean;
  cbo_budget: number;
  result_type: string | null;
  result_types_count: number;
  // Etapa 89: true quando a busca de gasto/resultado (insights) da conta falhou
  // (ex.: limite de requisições da Meta) — nesse caso spend/CPA vieram zerados
  // por falta de dado, não porque a conta não gastou. Quem usa o spend (Ritmo,
  // aviso de investimento baixo) precisa tratar como "sem dado".
  insights_failed?: boolean;
  // Etapa 90: texto do erro da Meta (cortado) quando insights_failed — pra tela
  // mostrar o motivo real (limite de requisições, timeout, token, etc.).
  insights_error?: string;
}

// Etapa 124: várias telas/automações pedem essa lista quase juntas (Painel, Controle de Saldo, saldo, pagamento…) —
// repetir a mesma consulta dentro de 60s devolve a resposta anterior, e se a Meta falhar (limite de requisições)
// devolve a última lista boa (até 6h) em vez de erro.
export async function getAdAccounts(token: string): Promise<AdAccount[]> {
  return memoMeta(
    `adaccounts:${tokenTag(token)}`,
    60_000,
    async () => {
      const data = await metaGet<{ data: AdAccount[] }>(token, "/me/adaccounts", {
        fields: "id,account_id,name,account_status,disable_reason,balance,currency,amount_spent,spend_cap,business{id,name}",
        limit: "200",
      });
      return data.data ?? [];
    },
    { staleOnError: true },
  );
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

// Etapa 90: spendOnly = só o gasto (spend) — pula as 3 chamadas de orçamento
// diário (anúncios ativos, campanhas, conjuntos). O orçamento não muda com o
// período, então quem já busca ele em outra chamada (o gasto do mês até ontem,
// usado só no Ritmo) não precisa repetir. Nesse modo cost_per_result/daily_budget
// NÃO são confiáveis — só spend.
export interface InsightOptions {
  spendOnly?: boolean;
  // Ignora o backup diário (meta_daily_metrics) e pergunta o período INTEIRO à Meta. Usado no cache do
  // Monitor de CPA: o número que o gestor confere no Gerenciador tem que sair da Meta, não de uma cópia.
  skipStore?: boolean;
  // Etapa 185: gasto + resultado/CPA, mas SEM as chamadas de orçamento diário (anúncios ativos, campanhas,
  // conjuntos) — 1 chamada por conta em vez de 4. Usado na lista do Foco (CPA do mês pro status da Speed).
  // Nesse modo daily_budget vem 0 (não confiável); a exclusão por objetivo usa o `objective` da própria linha.
  skipBudget?: boolean;
}

export async function getAccountInsight(
  token: string,
  actId: string,
  datePreset: DateRangeInput,
  opts: InsightOptions = {},
): Promise<AccountInsight> {
  const spendOnly = opts.spendOnly === true;
  const skipBudget = spendOnly || opts.skipBudget === true;
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
  let budgetFailed = false;
  const excludedIds = new Set<string>();

  const campaignsWithActiveAd = new Set<string>();
  const adsetsWithActiveAd = new Set<string>();
  if (!skipBudget) try {
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
    budgetFailed = true;
  }

  if (!skipBudget) try {
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
      // Etapa 130: "0" (texto) conta como SEM orçamento — a Meta pode devolver daily_budget/lifetime_budget "0" numa campanha
      // sem CBO, e como texto "0" é verdadeiro no JS, a campanha era tratada como CBO de R$ 0 e os conjuntos dela sumiam da soma.
      if (Number(c.daily_budget) > 0) {
        const v = Number(c.daily_budget) / 100;
        dailyBudget += v;
        cboBudget += v;
      } else if (Number(c.lifetime_budget) > 0) {
        const v = lifetimeToDailyEquivalent(c.lifetime_budget, c.start_time, c.stop_time, c.created_time);
        dailyBudget += v;
        cboBudget += v;
      } else if (c.id) {
        activeNoCboIds.add(c.id);
      }
    }
  } catch (e) {
    console.error("campaigns err", id, e);
    budgetFailed = true;
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
        if (Number(a.daily_budget) > 0) {
          dailyBudget += Number(a.daily_budget) / 100;
        } else if (Number(a.lifetime_budget) > 0) {
          dailyBudget += lifetimeToDailyEquivalent(a.lifetime_budget, a.start_time, a.end_time, a.created_time);
        }
      }
    } catch (e) {
      console.error("adsets budget err", id, e);
      budgetFailed = true;
    }
  }

  const resultTypesSet = new Set<string>();
  let lastResultType: string | null = null;
  let insightsFailed = false;
  let insightsError: string | undefined;
  try {
    type InsRes = {
      data: Array<{
        campaign_id?: string;
        campaign_name?: string;
        objective?: string;
        spend?: string;
        results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
        actions?: Array<{ action_type?: string; value?: string }>;
        cost_per_result?: Array<{ values?: Array<{ value?: string }> }>;
      }>;
    };
    // Etapa 90: no modo só-gasto, pede só o necessário (mais leve = menos chance de
    // estourar limite/timeout da Meta) e, se vier vazio, tenta mais uma vez — a Meta
    // às vezes devolve lista vazia sem erro quando está sobrecarregada, o que virava
    // "gasto zero" e inflava o Ritmo.
    // Etapa 125: os dias FECHADOS do período vêm do backup diário no Supabase (meta_daily_metrics); a Meta
    // só é perguntada pelo que falta — normalmente só o dia de hoje. Sem backup (conta nova, período
    // desconhecido, banco fora do ar) = caminho de sempre: o período inteiro na Meta.
    const stored = opts.skipStore ? null : await planFromStore(actId, datePreset).catch(() => null);
    const fetchIns = () =>
      metaGet<InsRes>(token, `/${id}/insights`, {
        fields: spendOnly
          ? "campaign_id,campaign_name,spend"
          : "campaign_id,campaign_name,objective,spend,actions,cost_per_action_type,results,cost_per_result",
        ...(stored?.live ? { time_range: JSON.stringify(stored.live) } : presetParams(datePreset)),
        level: "campaign",
        limit: "500",
        ...(spendOnly ? {} : { use_unified_attribution_setting: "true" }),
      });
    let ins: InsRes = { data: [] };
    if (!stored || stored.live) {
      ins = await fetchIns();
      if (spendOnly && !stored && (ins.data ?? []).length === 0) {
        await new Promise((r) => setTimeout(r, 800));
        ins = await fetchIns();
      }
    }
    let totalResults = 0;
    let hasResults = false;
    for (const day of stored?.used ?? []) {
      spend += day.spend;
      cpaSpend += day.cpaSpend;
      if (day.results > 0) {
        totalResults += day.results;
        hasResults = true;
      }
      for (const t of day.types) {
        resultTypesSet.add(t);
        lastResultType = t;
      }
    }
    for (const row of ins.data ?? []) {
      if (isJobCampaign(row.campaign_name)) continue;
      if (row.campaign_id && vagaIds.has(row.campaign_id)) continue;
      const rowSpend = row.spend ? Number(row.spend) : 0;
      // Etapa 84: campanha de objetivo excluído soma no investimento e para aqui
      // — não entra em cpaSpend, resultado nem tipo de resultado.
      spend += rowSpend;
      if (isVaga(row.campaign_name)) continue; // tag de nome (seguidores/tráfego): fora do CPA
      if (row.campaign_id && excludedIds.has(row.campaign_id)) continue;
      if (row.objective && EXCLUDED_OBJECTIVES.has(row.objective)) continue;
      // Etapa 184: resultado que não é lead/conversa (interação no post, clique, alcance…) — gasto fica só no Investimento.
      // Se a campanha tem conversas iniciadas em `actions`, elas valem (leadResultOf).
      const lr = leadResultOf(row.results, row.actions);
      if (isNonLeadResultType(lr.type)) continue;
      cpaSpend += rowSpend;
      const rowResults = lr.value;
      let rowType: string | null = null;
      if (rowResults != null && rowResults > 0) {
        const ind = lr.type;
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
      // Etapa 185: regra da Speed — investimento total ÷ conversas (cpaSpend fica só como referência).
      if (spend > 0) costPerResult = spend / totalResults;
    }
  } catch (e) {
    console.error("insights err", id, e);
    insightsFailed = true;
    insightsError = (e as Error).message.slice(0, 220);
  }

  return {
    account_id: actId,
    spend,
    cost_per_result: costPerResult,
    results,
    daily_budget: dailyBudget,
    budget_failed: budgetFailed || undefined,
    cbo_budget: cboBudget,
    result_type: lastResultType,
    result_types_count: resultTypesSet.size,
    insights_failed: insightsFailed || undefined,
    insights_error: insightsError,
  };
}

// Etapa 90: no máximo INSIGHTS_CONCURRENCY contas ao mesmo tempo (cada conta faz
// de 1 a 4 chamadas) — antes eram todas em paralelo (25 contas ≈ 100 chamadas de
// uma vez), o que estourava o limite de requisições da Meta.
const INSIGHTS_CONCURRENCY = 5;

export async function getAccountsInsights(
  token: string,
  accountIds: string[],
  datePreset: DateRangeInput,
  opts: InsightOptions = {},
): Promise<Record<string, AccountInsight>> {
  const out: Record<string, AccountInsight> = {};
  let next = 0;
  const worker = async () => {
    while (next < accountIds.length) {
      const actId = accountIds[next++];
      out[actId] = await getAccountInsight(token, actId, datePreset, opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(INSIGHTS_CONCURRENCY, accountIds.length) }, worker));
  // Etapa 89: contas cuja busca falhou (tipicamente limite de requisições da
  // Meta com muitas contas em paralelo) são tentadas de novo, uma de cada vez e
  // com uma pausa, até 2 rodadas — em vez de ficarem com gasto zerado.
  // Etapa 191: idem quando falhou a busca do ORÇAMENTO (antes o orçamento ficava 0 e o Ritmo mostrava "0,00").
  for (let round = 0; round < 2; round++) {
    const failed = accountIds.filter((id) => out[id]?.insights_failed || out[id]?.budget_failed);
    if (failed.length === 0) break;
    await new Promise((r) => setTimeout(r, 1500));
    for (const actId of failed) {
      out[actId] = await getAccountInsight(token, actId, datePreset, opts);
    }
  }
  return out;
}
