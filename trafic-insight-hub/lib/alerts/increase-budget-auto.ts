// Aumento automático de orçamento (Etapa 53) — pensado pra rodar 1x por dia
// de manhã (06h sugerido no n8n), aumentando sozinho em R$2,50 fixo (mesmo
// valor da ação manual, lib/meta/budget.ts) o orçamento diário de todo
// conjunto ATIVO com CPA bom nos ÚLTIMOS 3 DIAS (período fixo, não usa o
// período escolhido em nenhuma tela) — MESMA lógica de Painel > Análise >
// Conjuntos "abaixo da meta" (isAdSetFlaggedBelow): pelo menos 1 conversa
// iniciada no período e custo por conversa menor que a Meta CPA. Sem
// cooldown — roda 1x ao dia, cada rodada aumenta de novo quem continuar
// qualificado (não guarda "já aumentei esse hoje"). Conjunto com orçamento
// vitalício (lifetime) ou orçamento só na campanha (CBO) não tem como
// aumentar por aqui — entra em "failed", não avisa erro no WhatsApp, só no
// retorno da rota (pra não poluir a mensagem com casos que não são
// realmente um problema).

import type { createClient } from "@/lib/supabase/server";
import { getAdSetCostAnalysis } from "@/lib/meta/adset-cost-analysis";
import { isAdSetFlaggedBelow } from "@/lib/meta/analysis-thresholds";
import { increaseAdSetDailyBudget } from "@/lib/meta/budget";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;
const DATE_PRESET = "last_3d" as const;

export interface IncreasedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  ok: boolean;
  new_daily_budget?: number;
  error?: string;
}

export interface CheckIncreaseBudgetResult {
  increased: IncreasedAdSet[];
  sendError: string | null;
}

export async function checkAndIncreaseBudgets(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckIncreaseBudgetResult> {
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { increased: [], sendError: null };

  const flagged: { ad_account_id: string; client_name: string; adset_id: string; adset_name: string }[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows = await getAdSetCostAnalysis(token, accountId, DATE_PRESET);
        for (const r of rows) {
          if (!isAdSetFlaggedBelow(r, cpaTarget)) continue;
          flagged.push({ ad_account_id: accountId, client_name: clientName, adset_id: r.id, adset_name: r.name });
        }
      } catch (e) {
        console.error("increase-budget-auto analysis err (non-fatal)", accountId, e);
      }
    }),
  );

  const increased: IncreasedAdSet[] = [];
  for (const f of flagged) {
    const result = await increaseAdSetDailyBudget(token, f.adset_id);
    increased.push({
      ...f,
      ok: result.ok,
      new_daily_budget: result.ok ? result.newDailyBudget : undefined,
      error: result.ok ? undefined : result.error,
    });
  }

  const increasedOk = increased.filter((i) => i.ok).sort((a, b) => a.client_name.localeCompare(b.client_name, "pt-BR"));

  let sendError: string | null = null;
  if (opts.send && increasedOk.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = increasedOk.map(
        (i, idx) => `${idx + 1}. ${i.client_name} — ${i.adset_name}: novo orçamento diário ${fmtCurrency(i.new_daily_budget ?? 0)}`,
      );
      const message = `📈 Orçamento aumentado automaticamente (CPA bom nos últimos 3 dias) — ${increasedOk.length} conjunto${
        increasedOk.length > 1 ? "s" : ""
      }\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { increased, sendError };
}
