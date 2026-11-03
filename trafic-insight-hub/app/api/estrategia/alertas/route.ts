import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkLowBalances } from "@/lib/alerts/balance";
import { checkPaymentErrors } from "@/lib/alerts/payment";
import { activitiesForAccounts } from "@/lib/estrategia/activities";

// Etapa 238 (Hub estratégico → Tráfego → Alertas): junta numa chamada os alertas que vêm do servidor.
//   saldo baixo e erro de pagamento: mesma checagem dos avisos automáticos, só que SEM mandar nada no WhatsApp;
//   erros de veiculação e localização: o último resultado das verificações automáticas (tabelas audit_*);
//   otimizações recentes: histórico de atividades da Meta (últimos 7 dias).
// CPA acima do ideal e investimento baixo são calculados na própria tela, com os números do Acompanhamento.
export const maxDuration = 60;

const norm = (id: string) => id.replace(/^act_/, "");

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown };
    const ids = Array.isArray(body.accountIds) ? body.accountIds.filter((x): x is string => typeof x === "string").map(norm) : [];
    const wanted = new Set(ids);

    const [bal, pay, errRows, locRows, acts] = await Promise.all([
      checkLowBalances(supabase, user.id, token, { send: false }).catch((e: Error) => ({ statuses: [], sendError: e.message })),
      checkPaymentErrors(supabase, user.id, token, { send: false }).catch((e: Error) => ({ statuses: [], sendError: e.message })),
      supabase
        .from("audit_error_status")
        .select("ad_account_id, entity_type, entity_name, error_message, checked_at")
        .eq("user_id", user.id),
      supabase
        .from("audit_location_status")
        .select("ad_account_id, adset_name, detail, checked_at")
        .eq("user_id", user.id),
      activitiesForAccounts(token, ids),
    ]);

    // Etapa 249: saldo de TODAS as contas com limite configurado (pré-paga/híbrida); quem está abaixo vem com low = true.
    const balance = bal.statuses
      .filter((s) => wanted.has(norm(s.ad_account_id)))
      .map((s) => ({
        ad_account_id: norm(s.ad_account_id),
        balance: s.balance,
        threshold: s.threshold,
        currency: s.currency,
        low: s.low,
        handled: s.handled,
      }));
    const payment = pay.statuses
      .filter((s) => s.hasError && wanted.has(norm(s.ad_account_id)))
      .map((s) => ({ ad_account_id: norm(s.ad_account_id), reason: s.reason }));

    const errors = ((errRows.data ?? []) as Array<{ ad_account_id: string; entity_type: string; entity_name: string | null; error_message: string; checked_at: string }>)
      .filter((r) => wanted.has(norm(r.ad_account_id)))
      .map((r) => ({
        ad_account_id: norm(r.ad_account_id),
        entity_type: r.entity_type,
        name: r.entity_name,
        reasons: r.error_message.split(" · "),
        checked_at: r.checked_at,
      }));

    type LocDetail = { reasons?: string[]; expansion_fixed?: boolean; paused?: boolean } | null;
    const location = ((locRows.data ?? []) as Array<{ ad_account_id: string; adset_name: string | null; detail: LocDetail; checked_at: string }>)
      .filter((r) => wanted.has(norm(r.ad_account_id)))
      .map((r) => ({
        ad_account_id: norm(r.ad_account_id),
        name: r.adset_name,
        reasons: r.detail?.reasons ?? [],
        expansionFixed: !!r.detail?.expansion_fixed,
        paused: !!r.detail?.paused,
        checked_at: r.checked_at,
      }));

    const activities = Object.fromEntries(Object.entries(acts.byAccount).map(([k, v]) => [norm(k), v]));

    return NextResponse.json({
      balance,
      payment,
      errors,
      location,
      activities,
      activitiesFailed: acts.failed.map(norm),
      warnings: [bal.sendError, pay.sendError, errRows.error?.message, locRows.error?.message].filter(Boolean),
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
