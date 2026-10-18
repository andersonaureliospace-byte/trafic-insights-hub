import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { scanAllNames } from "@/lib/naming/scan";

// Etapa 140: aba "Padrão de nomes" — varre as contas IVS (ou só uma, ?account=ID) e devolve só o que está fora do padrão.
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const account = new URL(request.url).searchParams.get("account") || undefined;
    const { items, failedAccounts, accounts, kept } = await scanAllNames(supabase, user.id, token, account);
    return NextResponse.json({
      items,
      failedAccounts,
      kept,
      accounts: accounts.map((a) => ({ ad_account_id: a.ad_account_id, client_name: a.client_name })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
