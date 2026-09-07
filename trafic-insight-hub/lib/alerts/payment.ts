// Checagem de contas com erro no pagamento (Etapa 38) — mesmo padrão de
// lib/alerts/balance.ts (status calculado + envio opcional pro WhatsApp com
// cooldown de 24h), mas olhando pra `account_status`/`disable_reason` da
// Meta em vez de saldo. Ao contrário do saldo baixo, considera TODAS as
// contas vinculadas (account_bindings), não só pré-paga/híbrida — problema
// de pagamento trava qualquer tipo de conta.

import type { createClient } from "@/lib/supabase/server";
import { getAdAccounts, type AdAccount } from "@/lib/meta/insights";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

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

export interface PaymentStatus {
  ad_account_id: string;
  client_name: string;
  reason: string | null;
  hasError: boolean;
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
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, payment_alert_sent_at")
    .eq("user_id", userId);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accounts = await getAdAccounts(token);
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  const statuses: PaymentStatus[] = [];
  const toAlert: PaymentStatus[] = [];
  const toReset: string[] = [];

  for (const b of bindings) {
    const acc = accountById.get(b.ad_account_id);
    if (!acc) continue;
    const reason = paymentReason(acc);
    const hasError = reason != null;
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
      alerted: false,
    };
    statuses.push(status);

    if (hasError && !withinCooldown) {
      toAlert.push(status);
    } else if (!hasError && b.payment_alert_sent_at) {
      toReset.push(b.ad_account_id);
    }
  }

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = toAlert.map((s) => `⚠️ ${s.client_name}: ${s.reason}`);
      const message = `Aviso de erro no pagamento\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
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
