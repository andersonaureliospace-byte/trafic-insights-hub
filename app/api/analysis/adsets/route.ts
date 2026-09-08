import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAdSetCostAnalysis, type AdSetCostRow, type AdSetCreativeRow } from "@/lib/meta/adset-cost-analysis";
import type { DateRangeInput } from "@/lib/meta/client";

// Painel > Análise, sub-painel "Conjuntos" — duas análises, escolhidas por
// `mode`:
//
// "above" (Etapa 44: limite subiu de 2x pra 3x da Meta CPA, mesmo limite
// pros dois casos — com ou sem conversa iniciada): só conjunto ATIVO com
// custo por conversa iniciada no TRIPLO (ou mais) da Meta CPA — ou, sem
// nenhuma conversa iniciada, com o próprio gasto já no triplo (ou mais) da
// Meta CPA (ex.: Meta CPA R$6 → só entra com R$18 ou mais, com ou sem
// conversa). Etapa 46: ENTRA TAMBÉM, direto, qualquer conjunto ATIVO sem
// nenhum anúncio ativo dentro dele — independe do CPA (às vezes nem tem
// gasto no período pra calcular) — só nesse sub-painel (não faz sentido
// avisar isso em "candidato a escalar").
//
// "below" (conjuntos candidatos a escalar, sem mudança): só conjunto
// ATIVO, com pelo menos uma conversa iniciada no período, e custo por
// conversa abaixo da Meta CPA.
export type AnalysisMode = "above" | "below";

const ABOVE_TARGET_MULTIPLIER = 3;

function isFlaggedAbove(row: AdSetCostRow, cpaTarget: number): boolean {
  if (!row.has_active_ad) return true; // Etapa 46: avisa mesmo sem bater o limite de CPA
  const threshold = cpaTarget * ABOVE_TARGET_MULTIPLIER;
  const noConversion = !row.conversations || row.conversations <= 0;
  if (noConversion) return row.spend >= threshold;
  return row.cost_per_conversation != null && row.cost_per_conversation >= threshold;
}

function isFlaggedBelow(row: AdSetCostRow, cpaTarget: number): boolean {
  return (
    !!row.conversations &&
    row.conversations > 0 &&
    row.cost_per_conversation != null &&
    row.cost_per_conversation < cpaTarget
  );
}

function sortKey(row: AdSetCostRow): number {
  return row.cost_per_conversation ?? row.spend;
}

type AdRowWithTrend = AdSetCreativeRow & { avg_cost_7d: number | null };
type AdSetRowWithTrend = Omit<AdSetCostRow, "ads"> & { avg_cost_7d: number | null; ads: AdRowWithTrend[] };

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  adsets: AdSetRowWithTrend[];
}

// Etapa 40: só na aba "acima da meta" — além do período escolhido na tela,
// busca também um recorte FIXO de "últimos 7 dias" (sempre o mesmo,
// independente do filtro de período) só pra saber se a média desse conjunto/
// criativo nos últimos 7 dias já está abaixo da Meta CPA — usado pra
// destacar a linha em verde na tela (um "esse já pode estar melhorando"),
// sem mudar o que entra ou não na lista. Dobra a quantidade de chamadas ao
// Graph API nessa aba especificamente (busca o período escolhido + o fixo de
// 7 dias); a aba "abaixo da meta" não faz essa busca extra.
async function attachSevenDayTrend(rows: AdSetCostRow[], token: string, accountId: string): Promise<AdSetRowWithTrend[]> {
  let trend: AdSetCostRow[] = [];
  try {
    trend = await getAdSetCostAnalysis(token, accountId, "last_7d");
  } catch (e) {
    console.error("adset 7d trend err (non-fatal)", accountId, e);
  }
  const adsetTrendMap = new Map(trend.map((t) => [t.id, t.cost_per_conversation]));
  const adTrendMap = new Map<string, number | null>();
  for (const t of trend) {
    for (const ad of t.ads) adTrendMap.set(ad.id, ad.cost_per_conversation);
  }
  return rows.map((r) => ({
    ...r,
    avg_cost_7d: adsetTrendMap.get(r.id) ?? null,
    ads: r.ads.map((ad) => ({ ...ad, avg_cost_7d: adTrendMap.get(ad.id) ?? null })),
  }));
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds : [];
    const datePreset = (body.datePreset ?? "last_3d_plus_today") as DateRangeInput;
    const mode: AnalysisMode = body.mode === "below" ? "below" : "above";
    if (accountIds.length === 0) return NextResponse.json({ groups: [], skipped: [] });

    const { data: bindings } = await supabase
      .from("account_bindings")
      .select("ad_account_id, client_name, cpa_target")
      .eq("user_id", user.id)
      .in("ad_account_id", accountIds);
    const bindingMap = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));

    const skipped: { accountId: string; clientName: string }[] = [];
    const groups: Group[] = [];

    await Promise.all(
      accountIds.map(async (accountId) => {
        const binding = bindingMap.get(accountId);
        const clientName = (binding?.client_name as string | null) || accountId;
        const cpaTarget = (binding?.cpa_target as number | null) ?? null;
        if (!cpaTarget) {
          skipped.push({ accountId, clientName });
          return;
        }
        try {
          const rows = await getAdSetCostAnalysis(token, accountId, datePreset);
          const filtered = rows.filter((r) => (mode === "below" ? isFlaggedBelow(r, cpaTarget) : isFlaggedAbove(r, cpaTarget)));
          // "above": pior primeiro (mais caro acima da meta). "below": melhor
          // primeiro (mais barato abaixo da meta) — candidato nº 1 a escalar.
          const sorted = filtered.sort((a, b) => (mode === "below" ? sortKey(a) - sortKey(b) : sortKey(b) - sortKey(a)));
          if (sorted.length === 0) return;
          const withTrend = mode === "above" ? await attachSevenDayTrend(sorted, token, accountId) : sorted.map((r) => ({ ...r, avg_cost_7d: null, ads: r.ads.map((a) => ({ ...a, avg_cost_7d: null })) }));
          groups.push({ accountId, clientName, cpaTarget, adsets: withTrend });
        } catch (e) {
          console.error("adset analysis err (non-fatal)", accountId, e);
        }
      }),
    );

    groups.sort((a, b) => b.adsets.length - a.adsets.length);
    return NextResponse.json({ groups, skipped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
