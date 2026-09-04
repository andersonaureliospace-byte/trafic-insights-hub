import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAdSetCostAnalysis, type AdSetCostRow } from "@/lib/meta/adset-cost-analysis";
import type { DateRangeInput } from "@/lib/meta/client";

// Painel > Análise, a nível de conjunto: só conjunto ATIVO com custo por
// conversa iniciada R$ 4 ou mais acima da Meta CPA — ou, sem nenhuma
// conversa iniciada, com o próprio gasto R$ 4 ou mais acima da Meta CPA.
// Mesma regra de sempre, agora somada por conjunto em vez de por anúncio.
const THRESHOLD_ABOVE_TARGET = 4;

function isFlagged(row: AdSetCostRow, cpaTarget: number): boolean {
  const noConversion = !row.conversations || row.conversations <= 0;
  if (noConversion) return row.spend - cpaTarget >= THRESHOLD_ABOVE_TARGET;
  return row.cost_per_conversation != null && row.cost_per_conversation - cpaTarget >= THRESHOLD_ABOVE_TARGET;
}

function sortKey(row: AdSetCostRow): number {
  return row.cost_per_conversation ?? row.spend;
}

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  adsets: AdSetCostRow[];
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
          const rows = await getAdSetCostAnalysis(token, accountId, datePreset);
          const above = rows.filter((r) => isFlagged(r, cpaTarget)).sort((a, b) => sortKey(b) - sortKey(a));
          if (above.length > 0) groups.push({ accountId, clientName, cpaTarget, adsets: above });
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
