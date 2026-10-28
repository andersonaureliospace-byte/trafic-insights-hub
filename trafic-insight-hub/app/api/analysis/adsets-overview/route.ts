import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll } from "@/lib/meta/client";
import { isVaga, EXCLUDED_OBJECTIVES } from "@/lib/meta/shared";

// Etapa 217: Análise → "Conjuntos da conta". UMA conta por vez (economiza requisição): 3 chamadas à Meta —
// conjuntos (status/orçamento), campanhas (objetivo) e insights por conjunto nos últimos 30 dias (gasto, impressões,
// conversas). Ignora campanhas [VAGA]/seguidores/tráfego e objetivos fora do CPA (mesma regra da Análise).
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
  campaign?: { name?: string; daily_budget?: string };
}
interface InsightRow {
  adset_id?: string;
  spend?: string;
  impressions?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

export interface OverviewAdset {
  id: string;
  name: string;
  campaign_name: string | null;
  status: string;
  daily_budget: number | null; // R$ por dia do conjunto (null = orçamento na campanha/CBO ou vitalício)
  cbo: boolean;
  created_time: string | null;
  spend: number;
  impressions: number;
  conversations: number;
  cpa: number | null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { accountId?: string };
    const accountId = String(body.accountId ?? "").trim();
    if (!accountId) throw new Error("Escolha a conta.");
    const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

    const { data: binding } = await supabase
      .from("account_bindings")
      .select("client_name, cpa_target")
      .eq("user_id", user.id)
      .eq("ad_account_id", accountId)
      .maybeSingle();

    const [adsets, campaigns, insights] = await Promise.all([
      metaGetAll<AdsetRow>(token, `/${act}/adsets`, {
        fields: "id,name,effective_status,status,daily_budget,lifetime_budget,created_time,campaign_id,campaign{name,daily_budget}",
        limit: "500",
      }),
      metaGetAll<{ id?: string; objective?: string; name?: string }>(token, `/${act}/campaigns`, { fields: "id,name,objective", limit: "500" }),
      metaGetAll<InsightRow>(token, `/${act}/insights`, {
        fields: "adset_id,spend,impressions,actions",
        level: "adset",
        date_preset: "last_30d",
        limit: "500",
        use_unified_attribution_setting: "true",
      }),
    ]);

    const skipCampaign = new Set<string>();
    for (const c of campaigns) {
      if (!c.id) continue;
      if (isVaga(c.name) || (c.objective && EXCLUDED_OBJECTIVES.has(c.objective))) skipCampaign.add(c.id);
    }
    const ins = new Map<string, { spend: number; impressions: number; conversations: number }>();
    for (const r of insights) {
      if (!r.adset_id) continue;
      const conv = (r.actions ?? []).find((a) => (a.action_type ?? "").includes("messaging_conversation_started"));
      ins.set(r.adset_id, {
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        conversations: conv?.value ? Number(conv.value) : 0,
      });
    }

    const rows: OverviewAdset[] = [];
    for (const a of adsets) {
      if (!a.id) continue;
      if (a.campaign_id && skipCampaign.has(a.campaign_id)) continue;
      if (isVaga(a.campaign?.name)) continue;
      const m = ins.get(a.id) ?? { spend: 0, impressions: 0, conversations: 0 };
      const status = (a.effective_status || a.status || "").toUpperCase();
      if (status === "DELETED" || status === "ARCHIVED") continue;
      const daily = Number(a.daily_budget ?? 0);
      rows.push({
        id: a.id,
        name: a.name || a.id,
        campaign_name: a.campaign?.name ?? null,
        status,
        daily_budget: daily > 0 ? daily / 100 : null,
        cbo: !(daily > 0) && Number(a.campaign?.daily_budget ?? 0) > 0,
        created_time: a.created_time ?? null,
        spend: m.spend,
        impressions: m.impressions,
        conversations: m.conversations,
        cpa: m.conversations > 0 ? m.spend / m.conversations : null,
      });
    }

    return NextResponse.json({
      accountId,
      clientName: (binding?.client_name as string | null) || accountId,
      cpaTarget: (binding?.cpa_target as number | null) ?? null,
      fetchedAt: new Date().toISOString(),
      adsets: rows,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
