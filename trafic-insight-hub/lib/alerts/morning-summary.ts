// Resumo das 7h (Etapa 137) — "Contas que precisam de atenção". Junta os sinais que o sistema já calcula (status da conta,
// CPA de ontem e dos 2 dias, Invest. diário ÷ Ritmo, saldo, erro de pagamento), dá pontos (lib/alerts/priority-score.ts) e
// manda pro grupo do WhatsApp (e pra aba Alertas) só as contas com mais pontos, em ordem, com um resumo do motivo.
// Só LÊ da Meta — não pausa nem altera nada. Cada sinal que falhar ao buscar simplesmente não pontua (não derruba o resumo).
// Também cobre o antigo "alerta preventivo": +1 ponto quando o CPL de ontem caiu num nível pior que o status da conta.

import type { createClient } from "@/lib/supabase/server";
import { getAccountsDailyCpa } from "@/lib/meta/daily-cpa";
import { checkLowBudget } from "@/lib/alerts/low-budget";
import { checkLowBalances } from "@/lib/alerts/balance";
import { checkPaymentErrors } from "@/lib/alerts/payment";
import { publishAlert } from "@/lib/alerts/notifications";
import { formatMorningSummary, rankAccounts, type AccountSignals, type ScoredAccount } from "@/lib/alerts/priority-score";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { saveAttentionSnapshot } from "@/lib/alerts/attention-snapshot";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface MorningSummaryResult {
  ranked: ScoredAccount[];
  text: string;
  failedSignals: string[]; // sinais que não deu pra buscar (aparece no retorno do hook)
  sendError: string | null;
}

// CPA do período (soma dos dias): gasto ÷ resultados; sem resultado, o próprio gasto (mesma ideia do status em massa).
function periodCpa(points: Array<{ spend: number; results: number }>): number | null {
  const spend = points.reduce((s, p) => s + p.spend, 0);
  const results = points.reduce((s, p) => s + p.results, 0);
  if (spend <= 0) return null;
  return results > 0 ? spend / results : spend;
}

export async function buildMorningSummary(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<MorningSummaryResult> {
  const { data: selected, error: selectedErr } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target, priority")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds.length > 0 ? accountIds : ["_"]);
  if (bindingsErr) throw bindingsErr;
  const bindingBy = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));

  const failedSignals: string[] = [];
  const [dailyRes, budgetRes, balanceRes, paymentRes] = await Promise.allSettled([
    // 3 dias sem hoje: [anteontem-1, anteontem, ontem] — ontem é o último ponto.
    getAccountsDailyCpa(token, accountIds, 3, false),
    checkLowBudget(db, userId, token, { send: false }),
    checkLowBalances(db, userId, token, { send: false }),
    checkPaymentErrors(db, userId, token, { send: false }),
  ]);
  const daily = dailyRes.status === "fulfilled" ? dailyRes.value : (failedSignals.push("CPA diário"), {});
  const budgets = budgetRes.status === "fulfilled" ? new Map(budgetRes.value.statuses.map((s) => [s.ad_account_id, s])) : (failedSignals.push("Ritmo"), new Map());
  const balances = balanceRes.status === "fulfilled" ? new Map(balanceRes.value.statuses.map((s) => [s.ad_account_id, s])) : (failedSignals.push("Saldo"), new Map());
  const payments = paymentRes.status === "fulfilled" ? new Map(paymentRes.value.statuses.map((s) => [s.ad_account_id, s])) : (failedSignals.push("Pagamento"), new Map());

  const signals: AccountSignals[] = accountIds.map((id) => {
    const b = bindingBy.get(id);
    const points = (daily as Record<string, Array<{ spend: number; results: number }>>)[id] ?? [];
    const yesterday = points.length > 0 ? points[points.length - 1] : null;
    const twoDays = points.slice(-2);
    const bal = balances.get(id);
    return {
      id,
      name: (b?.client_name as string | null) || id,
      status: (b?.priority as string | null) ?? null,
      cpaTarget: (b?.cpa_target as number | null) ?? null,
      cpaYesterday: yesterday ? periodCpa([yesterday]) : null,
      cpaTwoDays: twoDays.length === 2 ? periodCpa(twoDays) : null,
      ritmoPct: budgets.get(id)?.pct_of_ritmo ?? null,
      balanceLow: !!bal?.low,
      balanceEmpty: !!bal && bal.balance <= 0,
      paymentError: !!payments.get(id)?.hasError,
    };
  });

  const ranked = rankAccounts(signals);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date());
  const msg = formatMorningSummary(ranked, dateLabel);

  // Guarda a lista pro Painel marcar as contas (🚨 + filtro "Atenção"). Falhar aqui não derruba o resumo.
  // Só grava se os sinais principais foram buscados — senão uma falha da Meta apagaria as marcações.
  if (failedSignals.length === 0) {
    try {
      await saveAttentionSnapshot(db, userId, ranked);
    } catch (e) {
      console.error("attention snapshot save err", (e as Error).message);
    }
  }

  let sendError: string | null = null;
  if (opts.send) {
    try {
      await publishAlert(db, userId, {
        kind: "morning-summary",
        title: msg.title,
        body: msg.body,
        count: ranked.length,
        groupText: msg.groupText,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { ranked, text: msg.groupText, failedSignals, sendError };
}
