import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getCreativeCostAnalysis, type CreativeCostRow } from "@/lib/meta/creative-analysis";
import { isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";
import type { DateRangeInput } from "@/lib/meta/client";

// Painel > Análise, tela "Criativos" (Etapa 40 — antes vivia junto da tela
// de Conjuntos, na aba "CPA acima da meta"): limite mais sensível que o de
// Conjuntos, de propósito — pega o criativo problemático cedo, antes que o
// conjunto inteiro precise ser sinalizado. Com custo por conversa iniciada
// R$ 4 ou mais acima da Meta CPA (subiu de R$2 pra R$4 na Etapa 45) — ou,
// quando não teve NENHUMA conversa iniciada (não dá pra calcular custo por
// conversa), com o próprio gasto R$ 4 ou mais acima da Meta CPA. Só avalia
// contas com Meta CPA cadastrada (sem meta não dá pra saber o que é
// "acima"); as demais voltam em "skipped". Só considera anúncio ATIVO.
// Limite (isCreativeFlaggedAbove) agora mora em lib/meta/analysis-thresholds.ts
// (Etapa 53) — reaproveitado também pela automação de pausa automática.
const STATUSES = ["ACTIVE"];

function sortKey(row: CreativeCostRow): number {
  return row.cost_per_conversation ?? row.spend;
}

type CreativeRowWithTrend = CreativeCostRow & { avg_cost_7d: number | null };

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  ads: CreativeRowWithTrend[];
}

// Etapa 40: recorte FIXO de "últimos 7 dias" (sempre o mesmo, independente
// do período escolhido na tela) só pra saber se a média desse criativo nos
// últimos 7 dias já está abaixo da Meta CPA — usado pra destacar a linha em
// verde, sem mudar o que entra ou não na lista. Dobra as chamadas ao Graph
// API por conta (período escolhido + o fixo de 7 dias).
async function attachSevenDayTrend(rows: CreativeCostRow[], token: string, accountId: string): Promise<CreativeRowWithTrend[]> {
  let trend: CreativeCostRow[] = [];
  try {
    trend = await getCreativeCostAnalysis(token, accountId, "last_7d");
  } catch (e) {
    console.error("creative 7d trend err (non-fatal)", accountId, e);
  }
  const trendMap = new Map(trend.map((t) => [t.id, t.cost_per_conversation]));
  return rows.map((r) => ({ ...r, avg_cost_7d: trendMap.get(r.id) ?? null }));
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds : [];
    const datePreset = (body.datePreset ?? "last_3d_plus_today") as DateRangeInput;
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
          const rows = await getCreativeCostAnalysis(token, accountId, datePreset);
          const above = rows
            .filter((r) => STATUSES.includes((r.status ?? "").toUpperCase()))
            .filter((r) => isCreativeFlaggedAbove(r, cpaTarget))
            .sort((a, b) => sortKey(b) - sortKey(a));
          if (above.length === 0) return;
          const withTrend = await attachSevenDayTrend(above, token, accountId);
          groups.push({ accountId, clientName, cpaTarget, ads: withTrend });
        } catch (e) {
          console.error("creative analysis err (non-fatal)", accountId, e);
        }
      }),
    );

    groups.sort((a, b) => b.ads.length - a.ads.length);
    return NextResponse.json({ groups, skipped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
