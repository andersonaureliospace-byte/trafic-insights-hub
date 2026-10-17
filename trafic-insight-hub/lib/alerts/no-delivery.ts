// Alerta "conta sem anúncio ativo / sem entrega" (Etapa 138) — pensado pra rodar de hora em hora, das 8h às 21h (n8n).
// Só LÊ da Meta (nunca pausa nem altera nada). Pra cada conta exibida e ativa: busca 1 anúncio realmente ativo
// (effective_status ACTIVE) e o gasto/impressões de hoje, e aplica a regra pura de no-delivery-rule.ts.
// Sem repetir: a mesma conta + mesmo problema só avisa UMA vez por dia (confere as linhas já gravadas hoje na aba Alertas).
// Conta com erro ao buscar na Meta não entra (não gera alerta falso).

import type { createClient } from "@/lib/supabase/server";
import { metaGet } from "@/lib/meta/client";
import { todayBrt } from "@/lib/meta/daily-range";
import { publishAlert } from "@/lib/alerts/notifications";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import {
  classifyDelivery,
  formatNoDeliveryLine,
  hourBrt,
  isWatchHour,
  type DeliveryProblem,
} from "@/lib/alerts/no-delivery-rule";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface NoDeliveryItem {
  ad_account_id: string;
  client_name: string;
  problem: DeliveryProblem;
  line: string;
  alreadyAlerted: boolean;
}

export interface CheckNoDeliveryResult {
  items: NoDeliveryItem[];
  skippedOutsideHours: boolean;
  failedAccounts: string[];
  sendError: string | null;
}

const CONCURRENCY = 4;

async function inspectAccount(token: string, accountId: string): Promise<{ activeAds: number; spend: number; impressions: number }> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const ads = await metaGet<{ data?: Array<{ id: string }> }>(token, `/${act}/ads`, {
    fields: "id",
    limit: "1",
    filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
  });
  const activeAds = ads.data?.length ?? 0;
  if (activeAds === 0) return { activeAds: 0, spend: 0, impressions: 0 };
  const ins = await metaGet<{ data?: Array<{ spend?: string; impressions?: string }> }>(token, `/${act}/insights`, {
    fields: "spend,impressions",
    date_preset: "today",
  });
  const row = ins.data?.[0];
  return { activeAds, spend: Number(row?.spend ?? 0), impressions: Number(row?.impressions ?? 0) };
}

export async function checkNoDelivery(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; ignoreHours?: boolean } = { send: false },
): Promise<CheckNoDeliveryResult> {
  const hour = hourBrt();
  if (!opts.ignoreHours && !isWatchHour(hour)) {
    return { items: [], skippedOutsideHours: true, failedAccounts: [], sendError: null };
  }

  const { data: selected, error: selectedErr } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { items: [], skippedOutsideHours: false, failedAccounts: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds);
  if (bindingsErr) throw bindingsErr;
  const nameBy = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, (b.client_name as string | null) || (b.ad_account_id as string)]));

  const found: Array<{ id: string; problem: DeliveryProblem }> = [];
  const failedAccounts: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < accountIds.length) {
      const id = accountIds[next++];
      try {
        const r = await inspectAccount(token, id);
        const problem = classifyDelivery({ activeAds: r.activeAds, spendToday: r.spend, impressionsToday: r.impressions, hour });
        if (problem) found.push({ id, problem });
      } catch {
        failedAccounts.push(nameBy.get(id) ?? id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accountIds.length) }, worker));

  // Linhas já avisadas hoje (BRT começa às 03:00 UTC).
  const since = `${todayBrt()}T03:00:00.000Z`;
  const { data: prev } = await db
    .from("alert_notifications")
    .select("body")
    .eq("user_id", userId)
    .eq("kind", "no-delivery")
    .gte("created_at", since);
  const prevLines = new Set((prev ?? []).flatMap((r) => String(r.body ?? "").split("\n")));

  const items: NoDeliveryItem[] = found
    .map((f) => {
      const name = nameBy.get(f.id) ?? f.id;
      const line = formatNoDeliveryLine(name, f.problem);
      return { ad_account_id: f.id, client_name: name, problem: f.problem, line, alreadyAlerted: prevLines.has(line) };
    })
    .sort((a, b) => (a.problem === b.problem ? a.client_name.localeCompare(b.client_name) : a.problem === "no-active-ad" ? -1 : 1));

  let sendError: string | null = null;
  const fresh = items.filter((i) => !i.alreadyAlerted);
  if (opts.send && fresh.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "no-delivery",
        title: `🚨 Conta sem anúncio ativo / sem entrega (${fresh.length} conta${fresh.length > 1 ? "s" : ""})`,
        body: fresh.map((i) => i.line).join("\n"),
        count: fresh.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { items, skippedOutsideHours: false, failedAccounts, sendError };
}
