// Aumento programado de investimento (Etapa 139).
//  1) planBudgetIncreases — roda de madrugada (n8n): olha os últimos 3 dias (SEM hoje) de cada conjunto ativo e grava o
//     PLANO do dia em budget_increase_plan (quem aumenta e quanto). Não mexe em nada na Meta.
//  2) applyBudgetIncreases — roda às 6h (n8n; repete a cada poucos minutos até esvaziar a fila): aplica o plano em fila
//     (um conjunto de cada vez, com intervalo), conferindo na Meta, na hora, se o conjunto ainda está ativo e qual é o
//     orçamento atual. Sem limite de conjuntos por conta. Cada rodada tem tempo máximo; o que sobrar fica pra próxima.
// Regras de valores em budget-increase-rule.ts. Só orçamento do PRÓPRIO conjunto (ABO): CBO/vitalício são ignorados.

import type { createClient } from "@/lib/supabase/server";
import { metaGet, metaGetAll, metaPost } from "@/lib/meta/client";
import { getAdSetCostAnalysis } from "@/lib/meta/adset-cost-analysis";
import { addDaysYmd, todayBrt } from "@/lib/meta/daily-range";
import { loadQuarantine } from "@/lib/alerts/adset-quarantine";
import { decideIncrease, needsSevenDayForCap, stepForCpa, MIN_CONVERSATIONS } from "@/lib/alerts/budget-increase-rule";
import { publishAlert } from "@/lib/alerts/notifications";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface PlanRow {
  adset_id: string;
  ad_account_id: string;
  client_name: string | null;
  adset_name: string | null;
  cpa_target: number | null;
  cpa_3d: number | null;
  cpa_7d: number | null;
  conversations_3d: number | null;
  from_cents: number;
  step_cents: number;
  cap_cents: number;
  status: "planned" | "applied" | "skipped" | "failed";
  to_cents: number | null;
  note: string | null;
  plan_date: string;
  applied_at: string | null;
}

export interface PlanResult {
  planned: number;
  accounts: number;
  failedAccounts: string[];
  planDate: string;
}

interface AdsetBudgetRow {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export async function planBudgetIncreases(db: Db, userId: string, token: string): Promise<PlanResult> {
  const today = todayBrt();
  const range3 = { since: addDaysYmd(today, -3), until: addDaysYmd(today, -1) }; // 3 dias fechados, sem hoje

  const { data: selected, error: selErr } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (selErr) throw selErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { planned: 0, accounts: 0, failedAccounts: [], planDate: today };

  const { data: bindings, error: bErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bErr) throw bErr;

  let quarantine = new Map<string, { quarantine_until: string }>();
  try {
    quarantine = await loadQuarantine(db, userId);
  } catch (e) {
    console.error("budget-increase: quarentena indisponível (segue sem ela)", (e as Error).message);
  }
  const now = Date.now();

  // O que já foi decidido hoje (aplicado/pulado/falhou) não é refeito.
  const { data: existing } = await db.from("budget_increase_plan").select("adset_id, status").eq("user_id", userId).eq("plan_date", today);
  const done = new Set((existing ?? []).filter((r) => r.status !== "planned").map((r) => r.adset_id as string));

  const rows: Array<Record<string, unknown>> = [];
  const failedAccounts: string[] = [];

  for (const b of bindings ?? []) {
    const accountId = b.ad_account_id as string;
    const clientName = (b.client_name as string | null) || accountId;
    const cpaTarget = b.cpa_target as number;
    try {
      const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
      const [rows3, budgets] = await Promise.all([
        getAdSetCostAnalysis(token, accountId, range3),
        metaGetAll<AdsetBudgetRow>(token, `/${act}/adsets`, {
          fields: "id,daily_budget,lifetime_budget",
          limit: "500",
          filtering: JSON.stringify([{ field: "adset.effective_status", operator: "IN", value: ["ACTIVE"] }]),
        }),
      ]);
      const budgetBy = new Map(budgets.map((x) => [x.id, x]));

      // Candidatos: ativo de verdade (com anúncio ativo), orçamento diário próprio, fora da quarentena.
      const cands = rows3.filter((r) => {
        if (!r.has_active_ad || done.has(r.id)) return false;
        const bud = budgetBy.get(r.id);
        if (!bud?.daily_budget || Number(bud.daily_budget) <= 0) return false;
        const q = quarantine.get(r.id);
        if (q && new Date(q.quarantine_until).getTime() > now) return false;
        return true;
      });

      // 7 dias só se o teto de R$35 puder fazer diferença para algum candidato.
      const need7 = cands.some((r) => {
        const cur = Number(budgetBy.get(r.id)!.daily_budget);
        const step = r.cost_per_conversation != null ? stepForCpa(r.cost_per_conversation, cpaTarget) : 0;
        return (r.conversations ?? 0) >= MIN_CONVERSATIONS && needsSevenDayForCap(cur, step);
      });
      let by7 = new Map<string, number | null>();
      if (need7) {
        try {
          const rows7 = await getAdSetCostAnalysis(token, accountId, "last_7d");
          by7 = new Map(rows7.map((r) => [r.id, r.cost_per_conversation]));
        } catch (e) {
          console.error("budget-increase 7d err (usa teto R$30)", accountId, e);
        }
      }

      for (const r of cands) {
        const cur = Number(budgetBy.get(r.id)!.daily_budget);
        const cpa7 = by7.get(r.id) ?? null;
        const d = decideIncrease({
          cpa3d: r.cost_per_conversation,
          conversations3d: r.conversations,
          cpaTarget,
          currentCents: cur,
          cpa7d: cpa7,
        });
        if (d.action !== "increase") continue;
        rows.push({
          user_id: userId,
          plan_date: today,
          adset_id: r.id,
          ad_account_id: accountId,
          client_name: clientName,
          adset_name: r.name,
          cpa_target: cpaTarget,
          cpa_3d: r.cost_per_conversation,
          cpa_7d: cpa7,
          conversations_3d: r.conversations,
          from_cents: cur,
          step_cents: d.stepCents,
          cap_cents: d.capCents,
          status: "planned",
          planned_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("budget-increase plan err (non-fatal)", accountId, e);
      failedAccounts.push(clientName);
    }
  }

  // Recria o que ainda está "planejado" hoje (refaz o plano); o que já foi decidido fica como está.
  const { error: delErr } = await db.from("budget_increase_plan").delete().eq("user_id", userId).eq("plan_date", today).eq("status", "planned");
  if (delErr) throw new Error(`Plano de aumento indisponível (${delErr.message}). Rode a migration 0032_budget_increase_plan.sql no Supabase.`);
  if (rows.length > 0) {
    const { error: insErr } = await db.from("budget_increase_plan").upsert(rows, { onConflict: "user_id,plan_date,adset_id" });
    if (insErr) throw new Error(`Não consegui gravar o plano de aumento: ${insErr.message}`);
  }
  return { planned: rows.length, accounts: (bindings ?? []).length, failedAccounts, planDate: today };
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  failed: number;
  remaining: number; // ainda "planejados" (acabou o tempo desta rodada)
  sendError: string | null;
}

const APPLY_DELAY_MS = 2000;

export async function applyBudgetIncreases(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; deadlineMs?: number; adsetIds?: string[] } = { send: false },
): Promise<ApplyResult> {
  const today = todayBrt();
  const deadline = opts.deadlineMs ?? Date.now() + 48_000;
  let q = db.from("budget_increase_plan").select("*").eq("user_id", userId).eq("plan_date", today).eq("status", "planned").order("client_name");
  if (opts.adsetIds && opts.adsetIds.length > 0) q = q.in("adset_id", opts.adsetIds);
  const { data, error } = await q;
  if (error) throw new Error(`Plano de aumento indisponível (${error.message}). Rode a migration 0032_budget_increase_plan.sql no Supabase.`);
  const queue = (data ?? []) as PlanRow[];

  const appliedLines: string[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  const mark = async (r: PlanRow, patch: Record<string, unknown>) => {
    await db
      .from("budget_increase_plan")
      .update(patch)
      .eq("user_id", userId)
      .eq("plan_date", today)
      .eq("adset_id", r.adset_id);
  };

  for (const r of queue) {
    if (Date.now() + APPLY_DELAY_MS + 3000 > deadline) break; // sem tempo: o resto fica pra próxima rodada
    processed++;
    try {
      // Confere na Meta, agora: continua ativo? qual é o orçamento atual?
      const live = await metaGet<{ id: string; effective_status?: string; daily_budget?: string }>(token, `/${r.adset_id}`, {
        fields: "id,effective_status,daily_budget",
      });
      const cur = Number(live.daily_budget ?? 0);
      if ((live.effective_status ?? "") !== "ACTIVE" || cur <= 0) {
        skipped++;
        await mark(r, { status: "skipped", note: "conjunto não está mais ativo (ou sem orçamento diário próprio)", applied_at: new Date().toISOString() });
        continue;
      }
      const newCents = Math.min(cur + r.step_cents, r.cap_cents);
      if (newCents <= cur) {
        skipped++;
        await mark(r, { status: "skipped", note: `orçamento atual (${fmtCurrency(cur / 100)}) já está no teto`, applied_at: new Date().toISOString() });
        continue;
      }
      await metaPost(token, `/${r.adset_id}`, { daily_budget: String(newCents) });
      applied++;
      await mark(r, { status: "applied", from_cents: cur, to_cents: newCents, applied_at: new Date().toISOString() });
      appliedLines.push(`• ${r.client_name ?? r.ad_account_id} — ${r.adset_name ?? r.adset_id}: ${fmtCurrency(cur / 100)} → ${fmtCurrency(newCents / 100)}`);
    } catch (e) {
      failed++;
      await mark(r, { status: "failed", note: (e as Error).message.slice(0, 300), applied_at: new Date().toISOString() });
    }
    await new Promise((res) => setTimeout(res, APPLY_DELAY_MS));
  }

  let sendError: string | null = null;
  if (opts.send && appliedLines.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "budget-increase",
        title: `📈 Orçamento aumentado (${appliedLines.length} conjunto${appliedLines.length > 1 ? "s" : ""})`,
        body: appliedLines.join("\n"),
        count: appliedLines.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { applied, skipped, failed, remaining: queue.length - processed, sendError };
}

// Lista do plano (hoje + últimos dias) pra tela de Análise.
export async function listBudgetPlan(db: Db, userId: string, days = 4): Promise<PlanRow[]> {
  const since = addDaysYmd(todayBrt(), -(days - 1));
  const { data, error } = await db
    .from("budget_increase_plan")
    .select("*")
    .eq("user_id", userId)
    .gte("plan_date", since)
    .order("plan_date", { ascending: false })
    .order("client_name");
  if (error) throw new Error(`Plano de aumento indisponível (${error.message}). Rode a migration 0032_budget_increase_plan.sql no Supabase.`);
  return (data ?? []) as PlanRow[];
}

export async function skipPlannedIncrease(db: Db, userId: string, adsetId: string): Promise<void> {
  await db
    .from("budget_increase_plan")
    .update({ status: "skipped", note: "pulado por você", applied_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("plan_date", todayBrt())
    .eq("adset_id", adsetId)
    .eq("status", "planned");
}
