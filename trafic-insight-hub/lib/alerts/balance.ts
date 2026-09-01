// Checagem de saldo baixo — usada tanto pela rota "Verificar agora" (sessão
// do usuário, em Mensagens > Avisos) quanto pelo hook público
// balance-alert-tick (service role, chamado pelo n8n). Só considera contas
// pré-paga/híbrida (pós-paga não fica sem saldo, é cobrada depois) que
// tenham um limite definido (explícito em alert_threshold, ou 20% do
// "Valor base" como padrão).

import type { createClient } from "@/lib/supabase/server";
import { getAdAccounts } from "@/lib/meta/insights";
import { availableFunds } from "@/lib/meta/funds";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // não reavisa a mesma conta antes de 24h

export interface BalanceStatus {
  ad_account_id: string;
  client_name: string;
  balance: number;
  currency: string;
  threshold: number;
  low: boolean;
  alerted: boolean;
}

export async function checkLowBalances(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; bypassCooldown?: boolean } = { send: false },
): Promise<BalanceStatus[]> {
  const { data: pixRows, error: pixErr } = await db
    .from("pix_accounts")
    .select("ad_account_id, payment_type, base_amount, alert_threshold, last_alert_sent_at")
    .eq("user_id", userId)
    .in("payment_type", ["prepaid", "hybrid"]);
  if (pixErr) throw pixErr;
  const withThreshold = (pixRows ?? []).filter(
    (p) => p.alert_threshold != null || p.base_amount != null,
  );
  if (withThreshold.length === 0) return [];

  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", userId);
  const clientNameById = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b.client_name as string]));

  const accounts = await getAdAccounts(token);
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  const statuses: BalanceStatus[] = [];
  const toAlert: BalanceStatus[] = [];
  const toReset: string[] = [];

  for (const p of withThreshold) {
    const acc = accountById.get(p.ad_account_id);
    if (!acc) continue;
    const threshold = (p.alert_threshold as number | null) ?? Number(p.base_amount) * 0.2;
    const balance = availableFunds(acc).amount;
    const low = balance < threshold;
    const clientName = clientNameById.get(p.ad_account_id) || acc.name;
    const withinCooldown =
      !opts.bypassCooldown &&
      !!p.last_alert_sent_at &&
      Date.now() - new Date(p.last_alert_sent_at).getTime() < COOLDOWN_MS;

    const status: BalanceStatus = {
      ad_account_id: p.ad_account_id,
      client_name: clientName,
      balance,
      currency: acc.currency,
      threshold,
      low,
      alerted: false,
    };
    statuses.push(status);

    if (low && !withinCooldown) {
      toAlert.push(status);
    } else if (!low && p.last_alert_sent_at) {
      toReset.push(p.ad_account_id);
    }
  }

  if (opts.send && toAlert.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (instance.alerts_group_id) {
        const lines = toAlert.map(
          (s) => `⚠️ ${s.client_name}: saldo ${fmtCurrency(s.balance, s.currency)} (limite ${fmtCurrency(s.threshold, s.currency)})`,
        );
        const message = `Aviso de saldo baixo\n\n${lines.join("\n")}`;
        await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
        const now = new Date().toISOString();
        for (const s of toAlert) {
          s.alerted = true;
          await db.from("pix_accounts").update({ last_alert_sent_at: now }).eq("user_id", userId).eq("ad_account_id", s.ad_account_id);
        }
      }
    } catch {
      // instância do WhatsApp não configurada, ou falha no envio — os
      // status calculados acima ainda voltam pra tela mesmo assim.
    }
  }

  if (toReset.length > 0) {
    await db
      .from("pix_accounts")
      .update({ last_alert_sent_at: null })
      .eq("user_id", userId)
      .in("ad_account_id", toReset);
  }

  return statuses;
}
