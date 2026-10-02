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

    // "activities" já confirmado que existe e tem evento
    // "ad_account_billing_charge" — agora pedindo extra_data (onde costuma
    // vir o detalhe do valor) e um período maior, pra pegar também o
    // "Pagamento manual" que não apareceu nos 5 mais recentes.
    const since = searchParams.get("since") ?? "2026-09-25";
    const until = searchParams.get("until") ?? "2026-10-03";
    const results: Record<string, unknown> = {};
    try {
      results.activities = await metaGet<Record<string, unknown>>(token, `/${id}/activities`, {
        fields: "event_type,event_time,translated_event_type,extra_data",
        since,
        until,
        limit: "100",
      });
    } catch (e) {
      results.activities = { error: (e as Error).message };
    }

    return NextResponse.json({ account_id: id, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
