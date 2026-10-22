// Aviso de investimento baixo (Etapa 53, limite ajustado na Etapa 54 e
// devolvido na Etapa 56) — pensado pra rodar de manhã, de segunda a sexta
// (07h/09h15/13h sugeridos no n8n), avisando (sem mexer em nada, só
// notifica) quais contas estão com o orçamento diário atual pelo menos
// R$10 MENOR que o Ritmo (quanto falta investir por dia pra bater a meta
// mensal) — mesma banda (RITMO_BAND) usada pra colorir a coluna Ritmo e o
// filtro Investimento de Acompanhamento. Histórico: a Etapa 54 tinha tirado
// essa banda daqui (QUALQUER diferença entrava), mas a Etapa 56 trouxe de
// volta por pedido explícito — diferenças pequenas (ex.: R$0,70, R$1,47,
// R$4,72) estavam poluindo o aviso sem necessidade real de ajuste. Só
// contas com Investimento mensal cadastrado entram na conta (sem meta não
// dá pra calcular Ritmo). Sem cooldown — quem controla a frequência é o
// agendamento do n8n; rodar de novo no mesmo dia reenvia de novo, de
// propósito.
// Etapa 187 (regra da Speed): a conta entra no aviso quando a SPEED mostra o investimento "Abaixo" — gasto do
// dia 01 até ONTEM menor que o ideal até HOJE com mais de 2% de diferença (lib/meta/speed.ts). Assim o aviso
// chega no mesmo momento em que a agência vê o alerta. "ritmo" agora é o orçamento recomendado pra HOJE
// (o que já gastou hoje + Gastar hoje; meta cheia, teto de 2x o ritmo médio) e "diff" = recomendado − orçamento atual.

import type { createClient } from "@/lib/supabase/server";
import { getAccountsInsights } from "@/lib/meta/insights";
import { monthCalendarSP } from "@/lib/meta/ritmo";
import { computeSpeed } from "@/lib/meta/speed";
import { publishAlert } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;

export interface LowInvestmentStatus {
  ad_account_id: string;
  client_name: string;
  daily_budget: number;
  ritmo: number; // Etapa 187: orçamento recomendado pra hoje (regra da Speed)
  diff: number; // recomendado − orçamento diário atual
  speed_diff_pct: number | null; // (gasto até ontem − ideal até hoje) ÷ ideal — o que a Speed compara
  low: boolean;
}

export interface CheckLowInvestmentResult {
  statuses: LowInvestmentStatus[];
  sendError: string | null;
}

export async function checkLowInvestment(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckLowInvestmentResult> {
  const off = await inactiveAccountIds(db, userId);
  const { data: bindingsAll, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, monthly_investment")
    .eq("user_id", userId)
    .not("monthly_investment", "is", null);
  if (bindingsErr) throw bindingsErr;
  const bindings = (bindingsAll ?? []).filter((b) => !off.has(b.ad_account_id as string));
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accountIds = bindings.map((b) => b.ad_account_id as string);
  // "this_month" dá, na mesma chamada, o gasto do mês até agora (com hoje)
  // (pro Ritmo, que desde a Etapa 85 compara com o Ideal até hoje) e o
  // orçamento diário atual (daily_budget não muda com o preset escolhido).
  const insights = await getAccountsInsights(token, accountIds, "this_month");
  // Gasto até ontem: dias fechados vêm do backup diário (quase sem chamada à Meta). No dia 01 não há dia fechado.
  const firstDay = monthCalendarSP().day === 1;
  const untilY = firstDay ? {} : await getAccountsInsights(token, accountIds, "this_month_until_yesterday", { spendOnly: true });

  const statuses: LowInvestmentStatus[] = bindings.map((b) => {
    const accountId = b.ad_account_id as string;
    const clientName = (b.client_name as string | null) || accountId;
    const insight = insights[accountId];
    const dailyBudget = insight?.daily_budget ?? 0;
    // Etapa 89: sem dado do mês (busca falhou) não dá pra saber — não
    // entra no aviso, pra não mandar alerta falso no WhatsApp.
    const u = (untilY as Record<string, { spend: number; insights_failed?: boolean }>)[accountId];
    const unknown = insight == null || insight.insights_failed === true || (!firstDay && (u == null || u.insights_failed === true));
    const s = computeSpeed({
      monthlyTarget: b.monthly_investment as number,
      spentSoFar: unknown ? null : insight.spend,
      spentUntilYesterday: unknown ? null : firstDay ? 0 : u!.spend,
      cpa: null,
      cpaTarget: null,
    });
    const recommended = (s.spentToday ?? 0) + (s.gastarHoje ?? 0);
    return {
      ad_account_id: accountId,
      client_name: clientName,
      daily_budget: dailyBudget,
      ritmo: recommended,
      diff: unknown ? 0 : recommended - dailyBudget,
      speed_diff_pct: s.speedDiffPct,
      low: !unknown && s.investStatus === "below",
    };
  });

  // Mais crítico (maior diferença, precisando investir bem mais do que está
  // configurado) primeiro, mesmo critério dos outros avisos.
  const low = statuses.filter((s) => s.low).sort((a, b) => (a.speed_diff_pct ?? 0) - (b.speed_diff_pct ?? 0));

  let sendError: string | null = null;
  if (opts.send && low.length > 0) {
    try {
      const lines = low.map(
        (s, i) =>
          `${i + 1}. ${s.client_name} — ${s.speed_diff_pct != null ? `${(s.speed_diff_pct * 100).toFixed(1).replace(".", ",")}% do ideal (Speed)` : "abaixo (Speed)"} | Invest. diário atual ${fmtCurrency(s.daily_budget)} | Recomendado hoje ${fmtCurrency(s.ritmo)}`,
      );
      await publishAlert(db, userId, {
        kind: "low-investment",
        title: `🟠 Investimento abaixo na Speed (${low.length} conta${low.length > 1 ? "s" : ""})`,
        body: lines.join("\n"),
        count: low.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
