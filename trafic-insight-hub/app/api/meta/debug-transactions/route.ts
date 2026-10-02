import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Diagnóstico temporário (seguindo o mesmo padrão do debug-funds, já
// removido): testar se alguma edge da Graph API expõe o histórico de
// "Atividade de pagamento" (pagamentos manuais, saldo pré-pago etc.) que
// aparece no Ads Manager. Rota isolada, só leitura, não mexe em nenhum
// fluxo existente. Remover depois de confirmado (apagar essa pasta).
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

    const candidateEdges = ["transactions", "activities", "payments"];
    const results: Record<string, unknown> = {};
    for (const edge of candidateEdges) {
      try {
        const data = await metaGet<Record<string, unknown>>(token, `/${id}/${edge}`, {
          limit: "5",
        });
        results[edge] = data;
      } catch (e) {
        results[edge] = { error: (e as Error).message };
      }
    }

    return NextResponse.json({ account_id: id, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
