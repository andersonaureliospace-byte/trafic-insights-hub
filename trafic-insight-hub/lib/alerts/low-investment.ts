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

import type { createClient } from "@/lib/supabase/server";
import { getAccountsInsights } from "@/lib/meta/insights";
import { ritmo, RITMO_BAND } from "@/lib/meta/ritmo";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface LowInvestmentStatus {
  ad_account_id: string;
  client_name: string;
  daily_budget: number;
  ritmo: number;
  diff: number; // Ritmo − orçamento diário atual
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
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, monthly_investment")
    .eq("user_id", userId)
    .not("monthly_investment", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accountIds = bindings.map((b) => b.ad_account_id as string);
  // "this_month" dá, na mesma chamada, o gasto do mês corrente (pro Ritmo) e
  // o orçamento diário atual (daily_budget não muda com o preset escolhido).
  const insights = await getAccountsInsights(token, accountIds, "this_month");

  const statuses: LowInvestmentStatus[] = bindings.map((b) => {
    const accountId = b.ad_account_id as string;
    const clientName = (b.client_name as string | null) || accountId;
    const insight = insights[accountId];
    const dailyBudget = insight?.daily_budget ?? 0;
    const rowRitmo = ritmo(b.monthly_investment as number, insight?.spend) ?? 0;
    const diff = rowRitmo - dailyBudget;
    return {
      ad_account_id: accountId,
      client_name: clientName,
      daily_budget: dailyBudget,
      ritmo: rowRitmo,
      diff,
      // Etapa 56: de volta à banda de R$10 (era diff > 0 desde a Etapa 54) —
      // só entra no aviso quem está passando de R$10 de diferença.
      low: diff > RITMO_BAND,
    };
  });

  // Mais crítico (maior diferença, precisando investir bem mais do que está
  // configurado) primeiro, mesmo critério dos outros avisos.
  const low = statuses.filter((s) => s.low).sort((a, b) => b.diff - a.diff);

  let sendError: string | null = null;
  if (opts.send && low.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = low.map(
        (s, i) =>
          `${i + 1}. ${s.client_name} — Invest. diário atual ${fmtCurrency(s.daily_budget)} | Ritmo necessário ${fmtCurrency(s.ritmo)}`,
      );
      const message = `🟠 Investimento baixo pra bater a meta do mês (${low.length} conta${
        low.length > 1 ? "s" : ""
      })\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
