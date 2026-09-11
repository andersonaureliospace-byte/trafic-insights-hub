import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { refreshCpaBoardCache } from "@/lib/meta/cpa-board-cache";

// Botão "Calcular agora" do Monitor de CPA — só existe pra destravar o
// primeiro uso (antes do hook diário cpa-board-cache-tick ter rodado pela
// primeira vez) ou pra forçar um recálculo manual pontual. No dia a dia,
// quem recalcula o cache é o hook agendado 1x por dia, não este botão.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { data: bindings, error: bindingsErr } = await supabase
      .from("account_bindings")
      .select("ad_account_id")
      .eq("user_id", user.id)
      .not("cpa_target", "is", null);
    if (bindingsErr) throw bindingsErr;
    const accountIds = (bindings ?? []).map((b) => b.ad_account_id as string);
    await refreshCpaBoardCache(supabase, user.id, token, accountIds);
    return NextResponse.json({ ok: true, accounts: accountIds.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
