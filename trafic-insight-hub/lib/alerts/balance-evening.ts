// Aviso das 19h (seg-sex) — "Saldo para amanhã" (Etapa 156). Serve pra ANTECIPAR o Pix: à noite o sistema estima como o saldo
// de cada conta Pix/Híbrida vai estar depois do gasto de amanhã e avisa as que ficariam abaixo do limite de alerta, pra dar tempo
// de programar o envio do Pix pro dia seguinte.
//
// Conta: saldo atual − gasto previsto de amanhã < limite de alerta  →  entra no aviso.
//  - saldo ........ o mesmo da tela / do aviso de saldo baixo (saldo por fundos quando ligado, senão disponível na Meta);
//  - gasto de amanhã o Ritmo (lib/meta/ritmo.ts — depois das 16h ele já é o valor do dia seguinte). Sem Ritmo (conta sem
//                   Investimento mensal cadastrado ou sem dado do mês) usa o Invest. diário (orçamento diário atual);
//  - limite ....... "Alertar quando <" da conta (ou 20% do Valor base), o mesmo do aviso de saldo baixo.
// Não entra conta com Pix já enviado há pouco ou já programado pra daqui pra frente (nada a antecipar). Só avisa — não envia Pix.
// Sem cooldown: roda uma vez por dia útil (quem controla é o n8n, 19h de segunda a sexta).

import type { createClient } from "@/lib/supabase/server";
import { getAdAccounts, getAccountsInsights } from "@/lib/meta/insights";
import { ritmoFromInsight } from "@/lib/meta/ritmo";
import { effectiveBalance } from "@/lib/alerts/balance";
import { getRecentSends } from "@/lib/alerts/recent-sends";
import { publishAlert } from "@/lib/alerts/notifications";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

// Regra pura: saldo depois do gasto de amanhã, e se fica abaixo do limite.
export function projectBalance(balance: number, spendTomorrow: number, threshold: number): { projected: number; low: boolean } {
  const projected = balance - spendTomorrow;
  return { projected, low: threshold > 0 && projected < threshold };
}

export interface EveningBalanceStatus {
  ad_account_id: string;
  client_name: string;
  currency: string;
  balance: number;
  spendTomorrow: number;
  spendSource: "ritmo" | "orcamento"; // de onde veio o gasto de amanhã
  projected: number;
  threshold: number;
  low: boolean;
  alreadyHandled: boolean; // Pix já enviado há pouco ou já programado
}

export interface CheckEveningBalancesResult {
  statuses: EveningBalanceStatus[];
  text: string; // texto do aviso (vazio se não tem conta)
  sendError: string | null;
}

export async function checkEveningBalances(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckEveningBalancesResult> {
  const off = await inactiveAccountIds(db, userId);
  const { data: pixRows, error: pixErr } = await db
    .from("pix_accounts")
    .select("ad_account_id, payment_type, base_amount, alert_threshold, funds_balance_enabled, funds_balance_amount")
    .eq("user_id", userId)
    .in("payment_type", ["pix", "hybrid"]);
  if (pixErr) throw pixErr;
  const rows = (pixRows ?? []).filter(
    (p) => !off.has(p.ad_account_id as string) && (p.alert_threshold != null || p.base_amount != null),
  );
  if (rows.length === 0) return { statuses: [], text: "", sendError: null };

  const ids = rows.map((p) => p.ad_account_id as string);
  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, monthly_investment")
    .eq("user_id", userId)
    .in("ad_account_id", ids);
  const bindingBy = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));

  const [accounts, insights, recent, scheduledRes] = await Promise.all([
    getAdAccounts(token),
    getAccountsInsights(token, ids, "this_month"),
    getRecentSends(db, userId),
    db.from("pix_sends").select("ad_account_id").eq("user_id", userId).eq("status", "scheduled").gt("scheduled_at", new Date().toISOString()),
  ]);
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));
  const scheduled = new Set((scheduledRes.data ?? []).map((r) => r.ad_account_id as string));

  const statuses: EveningBalanceStatus[] = [];
  for (const p of rows) {
    const id = p.ad_account_id as string;
    const acc = accountById.get(id);
    if (!acc) continue;
    const threshold = (p.alert_threshold as number | null) ?? Number(p.base_amount) * 0.2;
    const b = bindingBy.get(id);
    const insight = insights[id];
    const ritmo = ritmoFromInsight((b?.monthly_investment as number | null) ?? null, insight);
    const budget = insight && !insight.insights_failed ? (insight.daily_budget ?? 0) : null;
    const spendTomorrow = ritmo ?? budget;
    if (spendTomorrow == null) continue; // sem nenhuma base pra estimar: não arrisca aviso falso
    const balance = effectiveBalance(acc, p);
    const { projected, low } = projectBalance(balance, spendTomorrow, threshold);
    statuses.push({
      ad_account_id: id,
      client_name: (b?.client_name as string | null) || acc.name,
      currency: acc.currency,
      balance,
      spendTomorrow,
      spendSource: ritmo != null ? "ritmo" : "orcamento",
      projected,
      threshold,
      low,
      alreadyHandled: recent.pix.has(id) || scheduled.has(id),
    });
  }

  // Mais crítico (menor saldo projetado em relação ao limite) primeiro.
  const toAlert = statuses
    .filter((s) => s.low && !s.alreadyHandled)
    .sort((a, b) => a.projected - a.threshold - (b.projected - b.threshold));

  const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date());
  const title = `🌙 Saldo para amanhã (${dateLabel}) — programe o Pix`;
  const lines = toAlert.map(
    (s) =>
      `• ${s.client_name}: saldo ${fmtCurrency(s.balance, s.currency)} − ${s.spendSource === "ritmo" ? "Ritmo" : "orçamento diário"} ${fmtCurrency(
        s.spendTomorrow,
        s.currency,
      )} = ${fmtCurrency(s.projected, s.currency)} (limite ${fmtCurrency(s.threshold, s.currency)})`,
  );
  const text = toAlert.length > 0 ? `${title}\n\n${lines.join("\n")}` : "";

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "balance-evening",
        title,
        body: lines.join("\n"),
        count: toAlert.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { statuses, text, sendError };
}
