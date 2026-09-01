import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getCreativeCostAnalysis, type CreativeCostRow } from "@/lib/meta/creative-analysis";
import type { DateRangeInput } from "@/lib/meta/client";

// Painel > Análise: custo por conversa iniciada acima da Meta CPA + R$ 4,
// por cliente. Só avalia contas com Meta CPA cadastrada (sem meta não dá
// pra saber o que é "acima"); as demais voltam em "skipped".
const THRESHOLD_ABOVE_TARGET = 4;

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  ads: CreativeCostRow[];
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
            .filter(
              (r) => r.cost_per_conversation != null && r.cost_per_conversation - cpaTarget >= THRESHOLD_ABOVE_TARGET,
            )
            .sort((a, b) => (b.cost_per_conversation ?? 0) - (a.cost_per_conversation ?? 0));
          if (above.length > 0) groups.push({ accountId, clientName, cpaTarget, ads: above });
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
