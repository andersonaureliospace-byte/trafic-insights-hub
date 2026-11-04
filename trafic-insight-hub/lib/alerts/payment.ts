// Checagem de contas com erro no pagamento (Etapa 38) — mesmo padrão de
// lib/alerts/balance.ts (status calculado + envio opcional pro WhatsApp com
// cooldown de 24h), mas olhando pra `account_status`/`disable_reason` da
// Meta em vez de saldo. Ao contrário do saldo baixo, considera TODAS as
// contas vinculadas (account_bindings), não só Pix/Híbrida — problema
// de pagamento trava qualquer tipo de conta.

import type { createClient } from "@/lib/supabase/server";
import { getAdAccounts, type AdAccount } from "@/lib/meta/insights";
import { getRecentSends } from "@/lib/alerts/recent-sends";
import { publishAlert } from "@/lib/alerts/notifications";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { metaGet } from "@/lib/meta/client";
import { addDaysYmd, todayBrt } from "@/lib/meta/daily-range";
import { hourBrt } from "@/lib/alerts/no-delivery-rule";
type Db = Awaited<ReturnType<typeof createClient>>;

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // não reavisa a mesma conta antes de 24h

// account_status: https://developers.facebook.com/docs/marketing-api/reference/ad-account/
// 2 = DISABLED, 3 = UNSETTLED, 8 = PENDING_SETTLEMENT, 9 = IN_GRACE_PERIOD — todos
// ligados a cobrança/pagamento (ao contrário de, por ex., 1 = ACTIVE ou 100/101 =
// PENDING_RISK_REVIEW/PENDING_CLOSURE, que não são especificamente de pagamento).
const PAYMENT_STATUS_CODES = new Set([2, 3, 8, 9]);
// disable_reason 3 = RISK_PAYMENT (conta desabilitada especificamente por risco de pagamento).
const PAYMENT_DISABLE_REASON = 3;

const STATUS_LABELS: Record<number, string> = {
  2: "Conta desabilitada",
  3: "Pagamento pendente",
  8: "Aguardando liquidação",
  9: "Em período de carência",
};

function paymentReason(acc: AdAccount): string | null {
  if (acc.disable_reason === PAYMENT_DISABLE_REASON) return "Desabilitada por risco de pagamento";
  if (PAYMENT_STATUS_CODES.has(acc.account_status)) return STATUS_LABELS[acc.account_status] ?? "Erro no pagamento";
  return null;
}

// Etapa 255: erro na cobrança que a Meta NÃO mostra no status (caso IVS Muriaé, nov/2026: conta e anúncios
// todos ACTIVE pela API, mas a cobrança falhou e a entrega parou). Sinal usado: a conta tem anúncio ativo,
// gastou ontem e está com zero gasto e zero impressão hoje. Só a partir das 10h (antes disso é cedo pra concluir).
const STALL_FROM_HOUR = 10;
const STALL_REASON = "Possível erro na cobrança — gastou ontem e está sem entrega hoje (confira o Faturamento)";
const STALL_CONCURRENCY = 4;

async function isStalled(token: string, accountId: string): Promise<boolean> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const today = todayBrt();
  const yesterday = addDaysYmd(today, -1);
  const ins = await metaGet<{ data?: Array<{ date_start?: string; spend?: string; impressions?: string }> }>(token, `/${act}/insights`, {
    fields: "spend,impressions",
    time_range: JSON.stringify({ since: yesterday, until: today }),
    time_increment: "1",
  });
  const day = (d: string) => ins.data?.find((r) => r.date_start === d);
  const y = day(yesterday);
  const t = day(today);
  if (!(Number(y?.spend ?? 0) > 0)) return false; // não gastou ontem: não é o caso (conta parada de propósito)
  if (Number(t?.spend ?? 0) > 0 || Number(t?.impressions ?? 0) > 0) return false; // está entregando
  const ads = await metaGet<{ data?: Array<{ id: string }> }>(token, `/${act}/ads`, {
    fields: "id",
    limit: "1",
    filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
  });
  return (ads.data?.length ?? 0) > 0;
}

export interface PaymentStatus {
  ad_account_id: string;
  client_name: string;
  reason: string | null;
  hasError: boolean;
  // Etapa 96: boleto enviado nos últimos 30 min — o erro fica oculto (hasError = false).
  handled: boolean;
  alerted: boolean;
}

export interface CheckPaymentErrorsResult {
  statuses: PaymentStatus[];
  sendError: string | null;
}

export async function checkPaymentErrors(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; bypassCooldown?: boolean } = { send: false },
): Promise<CheckPaymentErrorsResult> {
  const off = await inactiveAccountIds(db, userId);
  const { data: bindingsAll, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, payment_alert_sent_at")
    .eq("user_id", userId);
  if (bindingsErr) throw bindingsErr;
  const bindings = (bindingsAll ?? []).filter((b) => !off.has(b.ad_account_id as string));
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accounts = await getAdAccounts(token);
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  // Etapa 255: contas sem erro no status, mas que travaram (ver isStalled). Erro ao consultar uma conta = não avisa.
  const stalled = new Set<string>();
  if (hourBrt() >= STALL_FROM_HOUR) {
    const todo = bindings
      .map((b) => b.ad_account_id as string)
      .filter((id) => {
        const acc = accountById.get(id);
        return acc && acc.account_status === 1 && !paymentReason(acc);
      });
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        try {
          if (await isStalled(token, id)) stalled.add(id);
        } catch (e) {
          console.error("payment stall check err", id, (e as Error).message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(STALL_CONCURRENCY, todo.length) }, worker));
  }

  const recent = await getRecentSends(db, userId);
  const statuses: PaymentStatus[] = [];
  const toAlert: PaymentStatus[] = [];
  const toReset: string[] = [];

  for (const b of bindings) {
    const acc = accountById.get(b.ad_account_id);
    if (!acc) continue;
    const reason = paymentReason(acc) ?? (stalled.has(b.ad_account_id) ? STALL_REASON : null);
    const handled = reason != null && recent.boleto.has(b.ad_account_id);
    const hasError = reason != null && !handled;
    const clientName = (b.client_name as string) || acc.name;
    const withinCooldown =
      !opts.bypassCooldown &&
      !!b.payment_alert_sent_at &&
      Date.now() - new Date(b.payment_alert_sent_at).getTime() < COOLDOWN_MS;

    const status: PaymentStatus = {
      ad_account_id: b.ad_account_id,
      client_name: clientName,
      reason,
      hasError,
      handled,
      alerted: false,
    };
    statuses.push(status);

    if (hasError && !withinCooldown) {
      toAlert.push(status);
    } else if (!hasError && !handled && b.payment_alert_sent_at) {
      toReset.push(b.ad_account_id);
    }
  }

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      const lines = toAlert.map((s) => `⚠️ ${s.client_name}: ${s.reason}`);
      await publishAlert(db, userId, {
        kind: "payment-error",
        title: "Aviso de erro no pagamento",
        body: lines.join("\n"),
        count: toAlert.length,
      });
      const now = new Date().toISOString();
      for (const s of toAlert) {
        s.alerted = true;
        await db.from("account_bindings").update({ payment_alert_sent_at: now }).eq("user_id", userId).eq("ad_account_id", s.ad_account_id);
      }
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  if (toReset.length > 0) {
    await db
      .from("account_bindings")
      .update({ payment_alert_sent_at: null })
      .eq("user_id", userId)
      .in("ad_account_id", toReset);
  }

  return { statuses, sendError };
}
