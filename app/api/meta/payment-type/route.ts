import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getIsPrepayAccounts } from "@/lib/meta/insights";

// Puxa is_prepay_account da Meta — chamado só pelo Controle de Saldo, e só
// pra contas que ainda não têm Tipo de conta salvo (a "criação" da conta
// naquela tela). De propósito uma rota separada da listagem de contas
// (api/meta/accounts), que roda toda vez que o Painel abre — isso aqui não
// deve rodar toda hora, só uma vez por conta nova.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds.map(String) : [];
    if (accountIds.length === 0) throw new Error("accountIds é obrigatório.");

    const isPrepay = await getIsPrepayAccounts(token, accountIds);
    return NextResponse.json({ isPrepay });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
