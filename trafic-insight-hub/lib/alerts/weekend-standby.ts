// Standby de fim de semana (Etapa 158) — as duas automações do n8n:
//  1) runWeekendStandby (sábado e domingo de madrugada): conjuntos ATIVOS de bom desempenho (CPA de 7 dias abaixo da meta)
//     ou criados há mais de 3 dias, com orçamento diário (ABO) acima de R$10, vão pra standby: orçamento = R$10,
//     criativos intocados. Fica registrado em weekend_standby (tela Auditoria → Standby).
//  2) releaseStandby (segunda 05h): todo conjunto em standby volta pra R$15 e sai da tela. Conjunto que já foi pausado
//     ou que já está com orçamento de R$15 ou mais só sai da lista (não mexe no orçamento).
// Idempotente: pode rodar várias vezes (a 1ª pode não dar tempo de todas as contas — o que já foi feito é pulado).

import type { createClient } from "@/lib/supabase/server";
import { getAdSetCostAnalysis } from "@/lib/meta/adset-cost-analysis";
import { getAdSetBudgetInfo, setAdSetDailyBudget, RESUME_BUDGET_CENTS, STANDBY_BUDGET_CENTS } from "@/lib/meta/budget";
import { metaGet } from "@/lib/meta/client";
import { isBelowIdeal7d, isNewAdSet } from "@/lib/alerts/adset-decision";
import { isWeekendBR, loadStandby, putAdsetOnStandby } from "@/lib/alerts/weekend";
import { publishAlert } from "@/lib/alerts/notifications";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

const OLD_ADSET_DAYS = 3;
const TIME_BUDGET_MS = 45_000; // a função tem 60s; o que sobrar fica pra próxima rodada

export interface StandbyRunResult {
  skipped?: string;
  put: number;
  noCut: number;
  errors: number;
  more: boolean; // true = acabou o tempo, falta gente (a próxima rodada continua)
  sendError: string | null;
}

export async function runWeekendStandby(db: Db, userId: string, token: string, opts: { send: boolean; force?: boolean } = { send: false }): Promise<StandbyRunResult> {
  const startedAt = Date.now();
  if (!opts.force && !isWeekendBR()) return { skipped: "não é sábado nem domingo", put: 0, noCut: 0, errors: 0, more: false, sendError: null };

  const { data: selected, error: selErr } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (selErr) throw selErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { put: 0, noCut: 0, errors: 0, more: false, sendError: null };

  const { data: bindings, error: bErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bErr) throw bErr;

  const standby = await loadStandby(db, userId);
  const now = new Date();
  const putByClient = new Map<string, number>();
  let put = 0;
  let noCut = 0;
  let errors = 0;
  let more = false;

  await Promise.all(
    (bindings ?? []).map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = Number(b.cpa_target);
      const clientName = (b.client_name as string | null) || accountId;
      try {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          more = true;
          return;
        }
        const rows3 = await getAdSetCostAnalysis(token, accountId, "last_3d_plus_today");
        const candidates = rows3.filter((r) => r.has_active_ad && !isNewAdSet(r.created_time, now) && !standby.has(r.id));
        if (candidates.length === 0) return;
        let by7 = new Map<string, { conversations: number | null; cost_per_conversation: number | null }>();
        try {
          by7 = new Map((await getAdSetCostAnalysis(token, accountId, "last_7d")).map((r) => [r.id, r]));
        } catch (e) {
          console.error("weekend-standby 7d err (só vale o critério de 3 dias nesta conta)", accountId, e);
        }
        for (const r of candidates) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            more = true;
            return;
          }
          const good = isBelowIdeal7d(by7.get(r.id), cpaTarget);
          const old = r.created_time ? now.getTime() - new Date(r.created_time).getTime() > OLD_ADSET_DAYS * 86_400_000 : false;
          if (!good && !old) continue;
          const out = await putAdsetOnStandby(db, userId, token, {
            adset_id: r.id,
            ad_account_id: accountId,
            client_name: clientName,
            adset_name: r.name,
            reason: good ? "bom desempenho" : "mais de 3 dias ativo",
          });
          if (out.kind === "standby") {
            put++;
            putByClient.set(clientName, (putByClient.get(clientName) ?? 0) + 1);
          } else if (out.kind === "no_cut") noCut++;
          else errors++;
        }
      } catch (e) {
        errors++;
        console.error("weekend-standby err (non-fatal)", accountId, e);
      }
    }),
  );

  let sendError: string | null = null;
  if (opts.send && put > 0) {
    try {
      const lines = [...putByClient.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `• ${c}: ${n} conjunto${n > 1 ? "s" : ""}`);
      await publishAlert(db, userId, {
        kind: "weekend-standby",
        title: `🌙 Standby de fim de semana: ${put} conjunto${put > 1 ? "s" : ""} com orçamento reduzido pra ${fmtCurrency(STANDBY_BUDGET_CENTS / 100)} (bom desempenho ou mais de ${OLD_ADSET_DAYS} dias ativos). Segunda 05h voltam pra ${fmtCurrency(RESUME_BUDGET_CENTS / 100)}.`,
        body: lines.join("\n"),
        count: put,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { put, noCut, errors, more, sendError };
}

export interface ReleaseResult {
  skipped?: string;
  raised: number;
  listedOnly: number;
  errors: number;
  more: boolean;
  sendError: string | null;
}

export async function releaseStandby(db: Db, userId: string, token: string, opts: { send: boolean; force?: boolean } = { send: false }): Promise<ReleaseResult> {
  const startedAt = Date.now();
  if (!opts.force && isWeekendBR()) return { skipped: "ainda é fim de semana", raised: 0, listedOnly: 0, errors: 0, more: false, sendError: null };

  const standby = await loadStandby(db, userId);
  let raised = 0;
  let listedOnly = 0;
  let errors = 0;
  let more = false;
  const lines: string[] = [];

  for (const rec of standby.values()) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      more = true;
      break;
    }
    let resume: number | null = null;
    if (rec.kind === "standby") {
      try {
        const st = await metaGet<{ effective_status?: string; status?: string }>(token, `/${rec.adset_id}`, { fields: "effective_status,status" });
        const status = (st.effective_status || st.status || "").toUpperCase();
        if (status === "ACTIVE") {
          const info = await getAdSetBudgetInfo(token, rec.adset_id);
          if (info.ok && info.info.scope === "adset" && info.info.currentCents < RESUME_BUDGET_CENTS) {
            const res = await setAdSetDailyBudget(token, rec.adset_id, RESUME_BUDGET_CENTS);
            if (!res.ok) {
              errors++;
              continue; // tenta de novo na próxima rodada
            }
            resume = RESUME_BUDGET_CENTS / 100;
            raised++;
            lines.push(`• ${rec.client_name ?? rec.ad_account_id} — ${rec.adset_name ?? rec.adset_id}: ${fmtCurrency(info.info.currentCents / 100)} → ${fmtCurrency(resume)}`);
          } else if (!info.ok && info.reason === "error") {
            errors++;
            continue;
          } else {
            listedOnly++;
          }
        } else {
          listedOnly++; // pausado ou outro status: não mexe no orçamento
        }
      } catch {
        errors++;
        continue;
      }
    } else {
      listedOnly++;
    }
    await db
      .from("weekend_standby")
      .update({ released_at: new Date().toISOString(), resume_budget: resume })
      .eq("user_id", userId)
      .eq("adset_id", rec.adset_id);
  }

  let sendError: string | null = null;
  if (opts.send && raised > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "weekend-standby",
        title: `☀️ Segunda: ${raised} conjunto${raised > 1 ? "s" : ""} saíram do standby (orçamento de volta pra ${fmtCurrency(RESUME_BUDGET_CENTS / 100)})`,
        body: lines.slice(0, 60).join("\n") + (lines.length > 60 ? `\n… e mais ${lines.length - 60}` : ""),
        count: raised,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { raised, listedOnly, errors, more, sendError };
}
