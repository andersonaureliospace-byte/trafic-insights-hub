import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll, spDate } from "@/lib/meta/client";
import { isVaga, EXCLUDED_OBJECTIVES } from "@/lib/meta/shared";
import { analysisRange, isAnalysisPeriod } from "@/lib/analysis-periods";

// Etapa 217: Análise → "Conjuntos da conta". UMA conta por vez (economiza requisição): 4 chamadas à Meta —
// conjuntos (status/orçamento), campanhas (objetivo) e insights por conjunto em dois períodos (Etapa 219):
// ONTEM + HOJE (filtros "Todos ativos" e "CPA acima/abaixo") e ÚLTIMOS 15 DIAS, contando hoje ("Com impressão"). Ignora campanhas [VAGA]/seguidores/tráfego e objetivos fora do CPA (mesma regra da Análise).
export const maxDuration = 60;

interface AdsetRow {
  id: string;
  name?: string;
  effective_status?: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: string;
  campaign_id?: string;
  campaign?: { name?: string; daily_budget?: string; effective_status?: string };
  targeting?: { age_min?: number; age_max?: number; targeting_automation?: { advantage_audience?: number } };
}
interface InsightRow {
  adset_id?: string;
  spend?: string;
  impressions?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

export interface PeriodMetrics {
  spend: number;
  impressions: number;
  conversations: number;
  cpa: number | null;
}

export interface OverviewAdset {
  id: string;
  name: string;
  campaign_name: string | null;
  campaign_id: string | null; // Etapa 231
  campaign_status: string | null; // Etapa 220: status da campanha (ACTIVE, PAUSED…)
  status: string;
  daily_budget: number | null; // R$ por dia do conjunto (null = orçamento na campanha/CBO ou vitalício)
  cbo: boolean;
  created_time: string | null;
  age_min: number | null; // Etapa 227: faixa etária do público
  age_max: number | null;
  advantage: boolean; // público Advantage+ (a idade máxima vira só sugestão pra Meta)
  d2: PeriodMetrics; // ontem + hoje
  d15: PeriodMetrics; // últimos 15 dias (contando hoje)
}

function toMetrics(rows: InsightRow[]): Map<string, PeriodMetrics> {
  const m = new Map<string, PeriodMetrics>();
  for (const r of rows) {
    if (!r.adset_id) continue;
    const conv = (r.actions ?? []).find((a) => (a.action_type ?? "").includes("messaging_conversation_started"));
    const spend = Number(r.spend ?? 0);
    const conversations = conv?.value ? Number(conv.value) : 0;
    m.set(r.adset_id, { spend, impressions: Number(r.impressions ?? 0), conversations, cpa: conversations > 0 ? spend / conversations : null });
  }
  return m;
}
const EMPTY: PeriodMetrics = { spend: 0, impressions: 0, conversations: 0, cpa: null };

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { accountId?: string; period?: string };
    const accountId = String(body.accountId ?? "").trim();
    if (!accountId) throw new Error("Escolha a conta.");
    const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

    // Etapa 224: filtro de período — com `period`, busca SÓ os números por conjunto nesse período (1 chamada à Meta).
    if (body.period != null) {
      if (!isAnalysisPeriod(body.period)) throw new Error("Período inválido.");
      const range = analysisRange(body.period);
      const insRows = await metaGetAll<InsightRow>(token, `/${act}/insights`, {
        fields: "adset_id,spend,impressions,actions",
        level: "adset",
        time_range: JSON.stringify(range),
        limit: "500",
        use_unified_attribution_setting: "true",
      });
      return NextResponse.json({ period: body.period, range, fetchedAt: new Date().toISOString(), metrics: Object.fromEntries(toMetrics(insRows)) });
    }

    const { data: binding } = await supabase
      .from("account_bindings")
      .select("client_name, cpa_target")
      .eq("user_id", user.id)
      .eq("ad_account_id", accountId)
      .maybeSingle();

    const now = new Date();
    const today = spDate(now);
    const yesterday = spDate(new Date(now.getTime() - 86_400_000));
    const since15 = spDate(new Date(now.getTime() - 14 * 86_400_000));
    const insightParams = (since: string) => ({
      fields: "adset_id,spend,impressions,actions",
      level: "adset",
      time_range: JSON.stringify({ since, until: today }),
      limit: "500",
      use_unified_attribution_setting: "true",
    });
    const [adsets, campaigns, ins2Rows, ins15Rows] = await Promise.all([
      metaGetAll<AdsetRow>(token, `/${act}/adsets`, {
        fields: "id,name,effective_status,status,daily_budget,lifetime_budget,created_time,campaign_id,campaign{name,daily_budget,effective_status},targeting{age_min,age_max,targeting_automation}",
        limit: "500",
      }),
      metaGetAll<{ id?: string; objective?: string; name?: string }>(token, `/${act}/campaigns`, { fields: "id,name,objective", limit: "500" }),
      metaGetAll<InsightRow>(token, `/${act}/insights`, insightParams(yesterday)),
      metaGetAll<InsightRow>(token, `/${act}/insights`, insightParams(since15)),
    ]);

    const skipCampaign = new Set<string>();
    for (const c of campaigns) {
      if (!c.id) continue;
      if (isVaga(c.name) || (c.objective && EXCLUDED_OBJECTIVES.has(c.objective))) skipCampaign.add(c.id);
    }
    const ins2 = toMetrics(ins2Rows);
    const ins15 = toMetrics(ins15Rows);

    const rows: OverviewAdset[] = [];
    for (const a of adsets) {
      if (!a.id) continue;
      if (a.campaign_id && skipCampaign.has(a.campaign_id)) continue;
      if (isVaga(a.campaign?.name)) continue;
      const status = (a.effective_status || a.status || "").toUpperCase();
      if (status === "DELETED" || status === "ARCHIVED") continue;
      const daily = Number(a.daily_budget ?? 0);
      rows.push({
        id: a.id,
        name: a.name || a.id,
        campaign_name: a.campaign?.name ?? null,
        campaign_id: a.campaign_id ?? null,
        campaign_status: (a.campaign?.effective_status ?? "").toUpperCase() || null,
        status,
        daily_budget: daily > 0 ? daily / 100 : null,
        cbo: !(daily > 0) && Number(a.campaign?.daily_budget ?? 0) > 0,
        created_time: a.created_time ?? null,
        age_min: a.targeting?.age_min ?? null,
        age_max: a.targeting?.age_max ?? null,
        advantage: Number(a.targeting?.targeting_automation?.advantage_audience ?? 0) === 1,
        d2: ins2.get(a.id) ?? EMPTY,
        d15: ins15.get(a.id) ?? EMPTY,
      });
    }

    return NextResponse.json({
      accountId,
      clientName: (binding?.client_name as string | null) || accountId,
      cpaTarget: (binding?.cpa_target as number | null) ?? null,
      fetchedAt: new Date().toISOString(),
      periods: { d2: { since: yesterday, until: today }, d15: { since: since15, until: today } },
      adsets: rows,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
