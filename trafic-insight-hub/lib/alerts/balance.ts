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

export interface CheckLowBalancesResult {
  statuses: BalanceStatus[];
  // Etapa 38: antes esse erro era engolido em silêncio (instância do
  // WhatsApp não configurada, grupo de avisos não definido, ou falha de
  // envio no uazapi) — o "Verificar agora" voltava como se tivesse dado
  // tudo certo mesmo sem mandar nada. Agora fica aqui pra tela mostrar de
  // verdade o que impediu o envio, sem esconder a tabela de status.
  sendError: string | null;
}

export async function checkLowBalances(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; bypassCooldown?: boolean } = { send: false },
): Promise<CheckLowBalancesResult> {
  const { data: pixRows, error: pixErr } = await db
    .from("pix_accounts")
    .select("ad_account_id, payment_type, base_amount, alert_threshold, last_alert_sent_at")
    .eq("user_id", userId)
    .in("payment_type", ["prepaid", "hybrid"]);
  if (pixErr) throw pixErr;
  const withThreshold = (pixRows ?? []).filter(
    (p) => p.alert_threshold != null || p.base_amount != null,
  );
  if (withThreshold.length === 0) return { statuses: [], sendError: null };

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

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
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
    } catch (e) {
      // Antes isso era descartado sem deixar rastro — agora sobe pra quem
      // chamou decidir o que mostrar (tela ou log do hook do n8n).
      sendError = (e as Error).message;
    }
  }

  if (toReset.length > 0) {
    await db
      .from("pix_accounts")
      .update({ last_alert_sent_at: null })
      .eq("user_id", userId)
      .in("ad_account_id", toReset);
  }

  return { statuses, sendError };
}

// Etapa 63: checagem extra de sexta-feira — pré-paga/híbrida com um
// multiplicador configurado (2x ou 3x) ficam "em alerta de fim de semana"
// quando o saldo disponível está abaixo de limite × multiplicador, mesmo que
// ainda não tenha cruzado o limite normal do checkLowBalances acima. Só faz
// sentido numa sexta-feira (fuso America/Sao_Paulo) — nos outros dias
// `applicable` vem false pra toda conta e nada é considerado baixo. Cooldown
// de 24h próprio (friday_alert_sent_at), separado do saldo baixo comum.
function isFridaySP(d: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  return weekday === "Fri";
}

export interface FridayBalanceStatus {
  ad_account_id: string;
  client_name: string;
  balance: number;
  currency: string;
  threshold: number;
  multiplier: number;
  fridayThreshold: number;
  applicable: boolean;
  low: boolean;
  alerted: boolean;
}

export interface CheckFridayLowBalancesResult {
  statuses: FridayBalanceStatus[];
  sendError: string | null;
}

export async function checkFridayLowBalances(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; bypassCooldown?: boolean } = { send: false },
): Promise<CheckFridayLowBalancesResult> {
  const applicable = isFridaySP();

  const { data: pixRows, error: pixErr } = await db
    .from("pix_accounts")
    .select("ad_account_id, payment_type, base_amount, alert_threshold, friday_multiplier, friday_alert_sent_at")
    .eq("user_id", userId)
    .in("payment_type", ["prepaid", "hybrid"])
    .not("friday_multiplier", "is", null);
  if (pixErr) throw pixErr;
  if (!pixRows || pixRows.length === 0) return { statuses: [], sendError: null };

  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", userId);
  const clientNameById = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b.client_name as string]));

  const accounts = await getAdAccounts(token);
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  const statuses: FridayBalanceStatus[] = [];
  const toAlert: FridayBalanceStatus[] = [];
  const toReset: string[] = [];

  for (const p of pixRows) {
    const acc = accountById.get(p.ad_account_id);
    if (!acc) continue;
    const threshold = (p.alert_threshold as number | null) ?? (p.base_amount != null ? Number(p.base_amount) * 0.2 : 0);
    const multiplier = Number(p.friday_multiplier);
    const fridayThreshold = threshold * multiplier;
    const balance = availableFunds(acc).amount;
    const low = applicable && fridayThreshold > 0 && balance < fridayThreshold;
    const clientName = clientNameById.get(p.ad_account_id) || acc.name;
    const withinCooldown =
      !opts.bypassCooldown &&
      !!p.friday_alert_sent_at &&
      Date.now() - new Date(p.friday_alert_sent_at).getTime() < COOLDOWN_MS;

    const status: FridayBalanceStatus = {
      ad_account_id: p.ad_account_id,
      client_name: clientName,
      balance,
      currency: acc.currency,
      threshold,
      multiplier,
      fridayThreshold,
      applicable,
      low,
      alerted: false,
    };
    statuses.push(status);

    if (low && !withinCooldown) {
      toAlert.push(status);
    } else if (!low && p.friday_alert_sent_at) {
      toReset.push(p.ad_account_id);
    }
  }

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = toAlert.map(
        (s) =>
          `⚠️ ${s.client_name}: saldo ${fmtCurrency(s.balance, s.currency)} (menos de ${s.multiplier}x o limite de ${fmtCurrency(s.threshold, s.currency)} — cuidado com o fim de semana)`,
      );
      const message = `Aviso de saldo baixo para o fim de semana\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
      const now = new Date().toISOString();
      for (const s of toAlert) {
        s.alerted = true;
        await db.from("pix_accounts").update({ friday_alert_sent_at: now }).eq("user_id", userId).eq("ad_account_id", s.ad_account_id);
      }
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  if (toReset.length > 0) {
    await db
      .from("pix_accounts")
      .update({ friday_alert_sent_at: null })
      .eq("user_id", userId)
      .in("ad_account_id", toReset);
  }

  return { statuses, sendError };
}
