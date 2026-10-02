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
    const results: Record<string, unknown> = {};

    // Testa se dá pra filtrar só os eventos de pagamento direto na Graph
    // API (bem mais barato que paginar tudo e filtrar aqui depois).
    for (const category of ["PAYMENT", "BILLING", "ADACCOUNT_BILLING", "ACCOUNT"]) {
      try {
        const data = await metaGet<Record<string, unknown>>(token, `/${id}/activities`, {
          fields: "event_type,event_time,extra_data",
          category,
          since: "2026-09-01",
          until: "2026-10-03",
          limit: "25",
        });
        results[`category_${category}`] = data;
      } catch (e) {
        results[`category_${category}`] = { error: (e as Error).message };
      }
    }

    // Conta quantas páginas tem só nos últimos 90 dias, sem filtro de
    // categoria, pra ter noção do volume total de eventos.
    try {
      let pages = 0;
      let count = 0;
      let url: string | null = null;
      const qs = new URLSearchParams({
        fields: "event_type",
        since: "2026-07-04",
        until: "2026-10-03",
        limit: "500",
      });
      let data = await metaGet<{ data: unknown[]; paging?: { next?: string } }>(
        token,
        `/${id}/activities`,
        Object.fromEntries(qs),
      );
      pages++;
      count += data.data.length;
      url = data.paging?.next ?? null;
      while (url && pages < 10) {
        const res = await fetch(url);
        data = (await res.json()) as { data: unknown[]; paging?: { next?: string } };
        pages++;
        count += data.data.length;
        url = data.paging?.next ?? null;
      }
      results.volume_90d = { pages_fetched: pages, total_events: count, reached_cap: pages >= 10 };
    } catch (e) {
      results.volume_90d = { error: (e as Error).message };
    }

    // Testa since sem until (igual o que o cálculo de saldo por fundos vai
    // usar de verdade) e desde uma data bem antiga, pra ver se pagina certo
    // e não trava/erra num histórico longo.
    try {
      let pages = 0;
      let count = 0;
      let url: string | null = null;
      let data = await metaGet<{ data: unknown[]; paging?: { next?: string } }>(
        token,
        `/${id}/activities`,
        { fields: "event_type,event_time,extra_data", since: "2015-01-01", limit: "500" },
      );
      pages++;
      count += data.data.length;
      url = data.paging?.next ?? null;
      while (url && pages < 30) {
        const res = await fetch(url);
        data = (await res.json()) as { data: unknown[]; paging?: { next?: string } };
        pages++;
        count += data.data.length;
        url = data.paging?.next ?? null;
      }
      results.full_history_since_only = { pages_fetched: pages, total_events: count, reached_cap: pages >= 30 };
    } catch (e) {
      results.full_history_since_only = { error: (e as Error).message };
    }

    return NextResponse.json({ account_id: id, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
