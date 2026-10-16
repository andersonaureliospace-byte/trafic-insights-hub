// Aviso de orçamento diário em 80% (ou menos) do Ritmo (Etapa 106; limite subiu de 50% pra 80% na Etapa 114) — só notifica, nunca mexe
// em nada. Pensado pra rodar de 3 em 3 horas no n8n (02h/05h/08h/11h/14h/17h/20h/23h), a mesma
// frequência da pausa automática. Avisa as contas cujo Invest. diário atual (orçamento diário
// somado das campanhas/conjuntos ativos) é igual ou menor que METADE do Ritmo — ou seja, o
// orçamento configurado nem chega perto do que precisa ser investido por dia. É um aviso mais
// grave que o de "Investimento baixo" (lib/alerts/low-investment.ts, banda de R$10), que
// continua existindo. O Ritmo é o mesmo da tela (lib/meta/ritmo.ts) — normal + o que falta pro ideal, sem teto; antes (até a Etapa 116) ele limitava a 2× e só depois das 16h já
// antecipa o dia seguinte. Universo: contas de "Contas exibidas" (user_selected_accounts) com
// Investimento mensal cadastrado. Sem cooldown: cada rodada reenvia enquanto o problema durar,
// de propósito (quem controla a frequência é o n8n).

import type { createClient } from "@/lib/supabase/server";
import { getAccountsInsights } from "@/lib/meta/insights";
import { ritmoFromInsight } from "@/lib/meta/ritmo";
import { publishAlert } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;

// Orçamento diário igual ou menor que esta fração do Ritmo entra no aviso (0,8 = 80%).
export const LOW_BUDGET_RATIO = 0.8;

// Regra pura: o Ritmo precisa ser positivo; orçamento igual ou abaixo de 80% dele avisa.
export function isBudgetAtMostRatioOfRitmo(dailyBudget: number, ritmo: number): boolean {
  return ritmo > 0 && dailyBudget <= ritmo * LOW_BUDGET_RATIO;
}

export interface LowBudgetStatus {
  ad_account_id: string;
  client_name: string;
  daily_budget: number;
  ritmo: number;
  pct_of_ritmo: number; // orçamento diário ÷ Ritmo (0-1+)
  low: boolean;
}

export interface CheckLowBudgetResult {
  statuses: LowBudgetStatus[];
  sendError: string | null;
}

export async function checkLowBudget(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckLowBudgetResult> {
  const { data: selected, error: selectedErr } = await db
    .from("user_selected_accounts")
    .select("ad_account_id")
    .eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { statuses: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, monthly_investment")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("monthly_investment", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const insights = await getAccountsInsights(
    token,
    bindings.map((b) => b.ad_account_id as string),
    "this_month",
  );

  const statuses: LowBudgetStatus[] = [];
  for (const b of bindings) {
    const accountId = b.ad_account_id as string;
    const insight = insights[accountId];
    // Sem dado do mês (busca falhou) não dá pra saber o Ritmo — não entra, pra não mandar alerta falso.
    if (!insight || insight.insights_failed) continue;
    const ritmo = ritmoFromInsight(b.monthly_investment as number, insight);
    if (ritmo == null) continue;
    const dailyBudget = insight.daily_budget ?? 0;
    statuses.push({
      ad_account_id: accountId,
      client_name: (b.client_name as string | null) || accountId,
      daily_budget: dailyBudget,
      ritmo,
      pct_of_ritmo: ritmo > 0 ? dailyBudget / ritmo : 0,
      low: isBudgetAtMostRatioOfRitmo(dailyBudget, ritmo),
    });
  }

  // Mais grave (menor % do Ritmo) primeiro.
  const low = statuses.filter((s) => s.low).sort((a, b) => a.pct_of_ritmo - b.pct_of_ritmo);

  let sendError: string | null = null;
  if (opts.send && low.length > 0) {
    try {
      const lines = low.map(
        (s, i) =>
          `${i + 1}. ${s.client_name} — Invest. diário ${fmtCurrency(s.daily_budget)} | Ritmo ${fmtCurrency(s.ritmo)} (${Math.round(
            s.pct_of_ritmo * 100,
          )}% do Ritmo)`,
      );
      await publishAlert(db, userId, {
        kind: "low-budget",
        title: `🔴 Invest. diário em 80% ou menos do Ritmo (${low.length} conta${low.length > 1 ? "s" : ""})`,
        body: lines.join("\n"),
        count: low.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
