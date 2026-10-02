import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Diagnóstico temporário (pergunta do usuário sobre o "Fundos" que aparece
// no Ads Manager, separado do Saldo/balance já usado em lib/meta/funds.ts).
// Rota isolada, só de leitura, não mexe em nenhum fluxo existente — o
// objetivo é só confirmar se a Graph API devolve algum campo equivalente
// a esse "Fundos" pra uma conta específica. Pra remover depois: apagar
// essa pasta (app/api/meta/debug-funds).
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id");
    if (!accountId) {
      return NextResponse.json({ error: "Informe ?account_id=<id da conta>" }, { status: 400 });
    }
    const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

    // Cada campo "candidato" é buscado numa chamada separada, pra um nome
    // de campo inválido não derrubar os outros.
    const candidateFields = [
      "balance",
      "spend_cap",
      "amount_spent",
      "funding_source_details",
      "adtrust_dsl",
    ];
    const results: Record<string, unknown> = {};
    for (const field of candidateFields) {
      try {
        const data = await metaGet<Record<string, unknown>>(token, `/${id}`, {
          fields: field,
        });
        results[field] = data[field] ?? null;
      } catch (e) {
        results[field] = { error: (e as Error).message };
      }
    }

    return NextResponse.json({ account_id: id, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
