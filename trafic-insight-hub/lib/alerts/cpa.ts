// Checagem de CPA acima da meta ONTEM (Etapa 48) — pensada pra rodar uma vez
// por dia, de manhã (07h sugerido no n8n), avisando o grupo de WhatsApp
// configurado com uma lista única de contas cujo CPA de ontem ficou mais de
// R$2 acima do CPA ideal cadastrado, da mais crítica pra menos crítica.
// Ao contrário de saldo/pagamento (lib/alerts/balance.ts, lib/alerts/payment.ts),
// não tem cooldown de 24h — o controle de frequência é o próprio agendamento
// do n8n (uma vez ao dia); rodar "Verificar agora" no mesmo dia reenvia de
// novo, de propósito, já que é uma ação manual explícita.

import type { createClient } from "@/lib/supabase/server";
import { getAccountsInsights } from "@/lib/meta/insights";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

// Mesma banda usada na cor da tela Evolução (Etapa 48): mais de R$2 acima
// do CPA ideal = crítico o bastante pra entrar no aviso.
const CRITICAL_DIFF = 2;

export interface CpaAlertStatus {
  ad_account_id: string;
  client_name: string;
  cpa_target: number;
  cpa_yesterday: number | null;
  diff: number | null; // CPA de ontem − CPA ideal (null sem dado/conversão ontem)
  critical: boolean;
}

export interface CheckCpaAlertsResult {
  statuses: CpaAlertStatus[];
  sendError: string | null;
}

export async function checkCpaAlerts(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckCpaAlertsResult> {
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accountIds = bindings.map((b) => b.ad_account_id as string);
  const insights = await getAccountsInsights(token, accountIds, "yesterday");

  const statuses: CpaAlertStatus[] = bindings.map((b) => {
    const accountId = b.ad_account_id as string;
    const cpaTarget = b.cpa_target as number;
    const clientName = (b.client_name as string | null) || accountId;
    const cpaYesterday = insights[accountId]?.cost_per_result ?? null;
    const diff = cpaYesterday != null ? cpaYesterday - cpaTarget : null;
    return {
      ad_account_id: accountId,
      client_name: clientName,
      cpa_target: cpaTarget,
      cpa_yesterday: cpaYesterday,
      diff,
      critical: diff != null && diff > CRITICAL_DIFF,
    };
  });

  // Mais crítico (maior diferença acima da meta) primeiro, pedido explícito.
  const critical = statuses.filter((s) => s.critical).sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));

  let sendError: string | null = null;
  if (opts.send && critical.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = critical.map(
        (s, i) => `${i + 1}. ${s.client_name} — CPA ideal ${fmtCurrency(s.cpa_target)} | CPA de ontem ${fmtCurrency(s.cpa_yesterday)}`,
      );
      const message = `🔴 CPA acima da meta ontem (${critical.length} conta${critical.length > 1 ? "s" : ""})\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
