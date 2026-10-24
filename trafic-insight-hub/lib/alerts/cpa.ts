// Checagem de CPA acima da meta (Etapa 48; Etapa 202: 3 rodadas por dia — veja CPA_WINDOWS) — avisa o grupo de
// WhatsApp configurado com uma lista única de contas acima do corte, da mais crítica pra menos crítica.
// Ao contrário de saldo/pagamento (lib/alerts/balance.ts, lib/alerts/payment.ts),
// não tem cooldown de 24h — o controle de frequência é o próprio agendamento
// do n8n (uma vez ao dia); rodar "Verificar agora" no mesmo dia reenvia de
// novo, de propósito, já que é uma ação manual explícita.

import type { createClient } from "@/lib/supabase/server";
import { getAccountsInsights } from "@/lib/meta/insights";
import { publishAlert } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;

// Etapa 202: três rodadas, cada uma com o seu corte (R$ acima do CPA ideal):
//  - "yesterday" (06h): CPA de ONTEM mais de R$4 acima do ideal;
//  - "midday"    (12h): CPA de HOJE até o momento mais de R$20 acima;
//  - "evening"   (18h30): CPA de HOJE até o momento mais de R$10 acima.
export type CpaWindow = "yesterday" | "midday" | "evening";
export const CPA_WINDOWS: Record<CpaWindow, { diff: number; preset: "yesterday" | "today"; label: string }> = {
  yesterday: { diff: 4, preset: "yesterday", label: "ontem" },
  midday: { diff: 20, preset: "today", label: "hoje até o meio-dia" },
  evening: { diff: 10, preset: "today", label: "hoje até as 18h" },
};

// Qual rodada pelo horário de Brasília (quando o n8n não manda): antes das 10h = ontem; até 17h = meio-dia; depois = noite.
export function cpaWindowByHour(now: Date = new Date()): CpaWindow {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)) % 24;
  if (h < 10) return "yesterday";
  if (h < 17) return "midday";
  return "evening";
}

export interface CpaAlertStatus {
  ad_account_id: string;
  client_name: string;
  cpa_target: number;
  cpa_yesterday: number | null; // CPA do período da rodada (ontem, ou hoje até agora nas rodadas do dia)
  diff: number | null; // CPA do período − CPA ideal (null sem dado/conversão)
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
  opts: { send: boolean; window?: CpaWindow } = { send: false },
): Promise<CheckCpaAlertsResult> {
  const window = opts.window ?? "yesterday";
  const cfg = CPA_WINDOWS[window];
  const off = await inactiveAccountIds(db, userId);
  const { data: bindingsAll, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  const bindings = (bindingsAll ?? []).filter((b) => !off.has(b.ad_account_id as string));
  if (!bindings || bindings.length === 0) return { statuses: [], sendError: null };

  const accountIds = bindings.map((b) => b.ad_account_id as string);
  const insights = await getAccountsInsights(token, accountIds, cfg.preset);

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
      critical: diff != null && diff > cfg.diff,
    };
  });

  // Mais crítico (maior diferença acima da meta) primeiro, pedido explícito.
  const critical = statuses.filter((s) => s.critical).sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));

  let sendError: string | null = null;
  if (opts.send && critical.length > 0) {
    try {
      const lines = critical.map(
        (s, i) =>
          `${i + 1}. ${s.client_name} — CPA ideal ${fmtCurrency(s.cpa_target)} | CPA ${window === "yesterday" ? "de ontem" : "de hoje"} ${fmtCurrency(s.cpa_yesterday)} (+${fmtCurrency(s.diff ?? 0)})`,
      );
      await publishAlert(db, userId, {
        kind: window === "yesterday" ? "cpa-yesterday" : "cpa-today",
        title: `🔴 CPA mais de ${fmtCurrency(cfg.diff)} acima da meta — ${cfg.label} (${critical.length} conta${critical.length > 1 ? "s" : ""})`,
        body: lines.join("\n"),
        count: critical.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
