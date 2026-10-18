import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { refreshCpaBoardCacheForUser } from "@/lib/meta/cpa-board-cache";

// Botão "Calcular agora" do Monitor de CPA — só existe pra destravar o
// primeiro uso (antes do hook diário cpa-board-cache-tick ter rodado pela
// primeira vez) ou pra forçar um recálculo manual pontual. No dia a dia,
// quem recalcula o cache é o hook agendado 1x por dia, não este botão.
export const maxDuration = 60;

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const accounts = await refreshCpaBoardCacheForUser(supabase, user.id, token);
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
