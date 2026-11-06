// Etapa 257: as conferências das Auditorias do Hub estratégico. Cada uma recebe UM lote de contas (a agenda divide),
// faz o mínimo de pedidos à Meta e devolve os achados — que entram na fila do resumo (digest.ts), nunca direto no WhatsApp.

import type { SupabaseClient } from "@supabase/supabase-js";
import { metaGet, metaGetAll, spDate } from "@/lib/meta/client";
import { getAccountInsight, getAdAccounts } from "@/lib/meta/insights";
import { isVaga, isJobCampaign, EXCLUDED_OBJECTIVES, leadResultOf, lifetimeToDailyEquivalent } from "@/lib/meta/shared";
import { evaluateTargetingDetailed, disableLocationExpansion } from "@/lib/audit/location";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { checkLowBalances } from "@/lib/alerts/balance";
import { isBudgetAtMostRatioOfRitmo } from "@/lib/alerts/low-budget";
import { ritmo } from "@/lib/meta/ritmo";
import { paymentReason } from "@/lib/alerts/payment";
import { getRecentSends } from "@/lib/alerts/recent-sends";
import { classifyDelivery, PROBLEM_TEXT } from "@/lib/alerts/no-delivery-rule";
import { readStoredDaysMany } from "@/lib/meta/daily-store";
import { checkAndUpdateBulkStatus } from "@/lib/alerts/bulk-status-update";
import { getPriorityOptions } from "@/lib/priority-labels";
import { normName } from "@/lib/asana/priority-sync";
import { calendarSP, ritmoOf, RITMO_BAND } from "@/lib/estrategia/calc";
import { fmtCurrency } from "@/lib/format";
import type { CheckId } from "./config";

export interface Acc {
  id: string; // sem act_
  name: string;
  responsible: string | null;
  cpaTarget: number | null;
  monthly: number | null;
  whatsapp: string | null;
}

export interface Finding {
  check: CheckId | "custo_pausa";
  acc: Acc;
  line: string;
  dedupe?: string; // mesmo item não entra duas vezes
}

export interface CheckResult {
  findings: Finding[];
  calls: number; // pedidos à Meta (estimativa)
  skipped: number; // contas que ficaram pra trás por tempo ou erro
  errors: string[];
}

const brl = (v: number) => fmtCurrency(v);
const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);
const todayBrt = () => spDate(new Date());
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Roda fn em cada conta (4 ao mesmo tempo), parando de pegar conta nova quando o tempo do lote acaba.
async function eachAccount(accounts: Acc[], deadline: number, fn: (a: Acc) => Promise<void>, errors: string[]): Promise<number> {
  let next = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < accounts.length) {
      const a = accounts[next++];
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      try {
        await fn(a);
      } catch (e) {
        skipped++;
        errors.push(`${a.name}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, accounts.length) }, worker));
  return skipped;
}

// ---------- Expansão de localização + WhatsApp (conjuntos criados/alterados desde a última conferência) ----------

interface AdsetRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  end_time?: string;
  updated_time?: string;
  created_time?: string;
  destination_type?: string;
  promoted_object?: { whatsapp_phone_number?: string; page_id?: string };
  targeting?: Parameters<typeof evaluateTargetingDetailed>[0];
  campaign?: { name?: string; effective_status?: string };
  ads?: { data?: Array<{ id: string }> };
}

const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
// Compara dois números de WhatsApp do Brasil: tira o 55, compara o DDD (se os dois tiverem) e os 8 últimos dígitos
// (assim "9" a mais na frente do celular não dá diferença falsa).
export function sameWhatsapp(a: string, b: string): boolean {
  const norm = (s: string) => {
    let d = digits(s);
    if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
    return { ddd: d.length >= 10 ? d.slice(0, 2) : null, tail: d.slice(-8) };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.tail.length < 8 || y.tail.length < 8) return true; // número incompleto: não acusa
  if (x.ddd && y.ddd && x.ddd !== y.ddd) return false;
  return x.tail === y.tail;
}

export async function runExpansaoWhatsapp(
  db: SupabaseClient,
  userId: string,
  token: string,
  accounts: Acc[],
  deadline: number,
  opts: { expansao: boolean; whatsapp: boolean },
): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const { data: last } = await db.from("estr_location_checks").select("ad_account_id, checked_at").eq("user_id", userId);
  const lastBy = new Map((last ?? []).map((r) => [r.ad_account_id as string, new Date(r.checked_at as string).getTime()]));
  const day = todayBrt();

  const skipped = await eachAccount(
    accounts,
    deadline,
    async (a) => {
      const started = Date.now();
      // Desde a última conferência (com 10 min de folga); conta nunca conferida: últimas 24h.
      const since = (lastBy.get(a.id) ?? started - 24 * 3600_000) - 10 * 60_000;
      const params: Record<string, string> = {
        fields:
          "id,name,status,effective_status,end_time,updated_time,created_time,destination_type,promoted_object,targeting,campaign{name,effective_status},ads.effective_status(['ACTIVE']).limit(1){id}",
        effective_status: JSON.stringify(["ACTIVE"]),
        limit: "200",
      };
      let rows: AdsetRow[];
      try {
        rows = await metaGetAll<AdsetRow>(
          token,
          `/${act(a.id)}/adsets`,
          { ...params, filtering: JSON.stringify([{ field: "updated_time", operator: "GREATER_THAN", value: Math.floor(since / 1000) }]) },
          3,
        );
      } catch (e) {
        if (/limit|#4\b|#17\b|80004|request limit/i.test((e as Error).message)) throw e;
        // A Meta recusou o filtro: busca os ativos todos (o corte por updated_time abaixo dá o mesmo resultado).
        rows = await metaGetAll<AdsetRow>(token, `/${act(a.id)}/adsets`, params, 3);
        calls++;
      }
      calls++;
      for (const r of rows) {
        if (r.updated_time && new Date(r.updated_time).getTime() < since) continue;
        if (String(r.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
        if (String(r.campaign?.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
        if ((r.ads?.data?.length ?? 0) === 0) continue;
        if (r.end_time && new Date(r.end_time).getTime() <= Date.now()) continue;
        const nome = r.name || r.id;

        if (opts.expansao) {
          const { blocking, expansion } = evaluateTargetingDetailed(r.targeting);
          if (blocking.length > 0) {
            const res = await setEntitiesStatusSequential(token, [{ id: r.id, type: "adset" }], "PAUSED", 0);
            calls++;
            findings.push({
              check: "expansao",
              acc: a,
              line: `${nome}: Brasil inteiro → ${res[0]?.ok ? "conjunto pausado" : `falha ao pausar (${res[0]?.error ?? "erro"})`}`,
              dedupe: `expansao:brasil:${r.id}:${day}`,
            });
          } else if (expansion) {
            const res = await disableLocationExpansion(token, r.id);
            calls += 3;
            findings.push({
              check: "expansao",
              acc: a,
              line: `${nome}: ${res.ok ? "expansão desligada" : `falha ao desligar a expansão (${res.error ?? "erro"}) — confira`}`,
              dedupe: `expansao:${r.id}:${r.updated_time ?? day}`,
            });
          }
        }

        if (opts.whatsapp && a.whatsapp) {
          const num = r.promoted_object?.whatsapp_phone_number;
          if (num && !sameWhatsapp(num, a.whatsapp)) {
            findings.push({
              check: "whatsapp",
              acc: a,
              line: `${nome}: WhatsApp do conjunto ${num} ≠ ficha ${a.whatsapp}`,
              dedupe: `whatsapp:${r.id}:${digits(num)}`,
            });
          }
        }
      }
      await db
        .from("estr_location_checks")
        .upsert({ user_id: userId, ad_account_id: a.id, checked_at: new Date(started).toISOString() }, { onConflict: "user_id,ad_account_id" });
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- Custo alto (conjuntos e criativos ativos, 2 dias fechados + hoje) ----------

interface AdIns {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_name?: string;
  objective?: string;
  spend?: string;
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type?: string; value?: string }>;
}

export const ALERT_X = 2; // acima de 2x o CPA ideal: avisa
export const PAUSE_X = 3; // acima de 3x (ou gastou 3x sem conversa): pausa

function over(spend: number, conv: number, ideal: number, x: number): boolean {
  if (spend < ideal * x) return false;
  return conv <= 0 || spend / conv > ideal * x;
}
const cpaTxt = (spend: number, conv: number) => (conv > 0 ? `CPA ${brl(spend / conv)}` : `${brl(spend)} sem conversa`);

export async function runCustoAlto(db: SupabaseClient, userId: string, token: string, accounts: Acc[], deadline: number): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const today = todayBrt();
  const since = addDays(today, -2);
  const list = accounts.filter((a) => a.cpaTarget && a.cpaTarget > 0);

  const skipped = await eachAccount(
    list,
    deadline,
    async (a) => {
      const ideal = a.cpaTarget as number;
      const rows = await metaGetAll<AdIns>(
        token,
        `/${act(a.id)}/insights`,
        {
          level: "ad",
          fields: "ad_id,ad_name,adset_id,adset_name,campaign_name,objective,spend,results,actions",
          time_range: JSON.stringify({ since, until: today }),
          filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
          use_unified_attribution_setting: "true",
          limit: "500",
        },
        3,
      );
      calls++;

      type Agg = { name: string; spend: number; conv: number; ads: Array<{ id: string; name: string; spend: number; conv: number }> };
      const adsets = new Map<string, Agg>();
      for (const r of rows) {
        if (!r.ad_id || !r.adset_id) continue;
        if (isVaga(r.campaign_name) || (r.objective && EXCLUDED_OBJECTIVES.has(r.objective))) continue;
        const spend = Number(r.spend ?? 0);
        if (spend <= 0) continue;
        const conv = leadResultOf(r.results, r.actions).value ?? 0;
        const g = adsets.get(r.adset_id) ?? { name: r.adset_name || r.adset_id, spend: 0, conv: 0, ads: [] };
        g.spend += spend;
        g.conv += conv;
        g.ads.push({ id: r.ad_id, name: r.ad_name || r.ad_id, spend, conv });
        adsets.set(r.adset_id, g);
      }

      const toPause: Array<{ id: string; type: "adset" | "ad"; line: string }> = [];
      for (const [adsetId, g] of adsets) {
        if (over(g.spend, g.conv, ideal, PAUSE_X)) {
          toPause.push({ id: adsetId, type: "adset", line: `Conjunto ${g.name}: ${cpaTxt(g.spend, g.conv)} (ideal ${brl(ideal)})` });
          continue; // o conjunto inteiro sai — não precisa listar os criativos
        }
        for (const ad of g.ads) {
          if (over(ad.spend, ad.conv, ideal, PAUSE_X)) {
            toPause.push({ id: ad.id, type: "ad", line: `Criativo ${ad.name} (${g.name}): ${cpaTxt(ad.spend, ad.conv)} (ideal ${brl(ideal)})` });
          } else if (over(ad.spend, ad.conv, ideal, ALERT_X)) {
            findings.push({
              check: "custo",
              acc: a,
              line: `Criativo ${ad.name} (${g.name}): ${cpaTxt(ad.spend, ad.conv)} (ideal ${brl(ideal)})`,
              dedupe: `custo:${ad.id}:${today}`,
            });
          }
        }
        if (!g.ads.some((ad) => over(ad.spend, ad.conv, ideal, ALERT_X)) && over(g.spend, g.conv, ideal, ALERT_X)) {
          findings.push({
            check: "custo",
            acc: a,
            line: `Conjunto ${g.name}: ${cpaTxt(g.spend, g.conv)} (ideal ${brl(ideal)})`,
            dedupe: `custo:${adsetId}:${today}`,
          });
        }
      }

      if (toPause.length > 0) {
        const res = await setEntitiesStatusSequential(
          token,
          toPause.map((p) => ({ id: p.id, type: p.type })),
          "PAUSED",
          1500,
        );
        calls += toPause.length;
        toPause.forEach((p, i) => {
          const ok = res[i]?.ok;
          findings.push({
            check: "custo_pausa",
            acc: a,
            line: `${p.line} → ${ok ? "PAUSADO" : `falha ao pausar (${res[i]?.error ?? "erro"}) — pause à mão`}`,
            dedupe: `pausa:${p.id}:${today}`,
          });
        });
      }
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- CPA alto no dia (hoje até agora) ----------

export const CPA_DIA_DIFF = { midday: 20, evening: 10 } as const;

export async function runCpaDia(token: string, accounts: Acc[], deadline: number, variant: "midday" | "evening"): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const diff = CPA_DIA_DIFF[variant];
  const label = variant === "midday" ? "meio-dia" : "tarde";
  const day = todayBrt();
  const list = accounts.filter((a) => a.cpaTarget && a.cpaTarget > 0);
  const skipped = await eachAccount(
    list,
    deadline,
    async (a) => {
      const ins = await getAccountInsight(token, a.id, "today", { skipBudget: true });
      calls++;
      if (ins.insights_failed) throw new Error(ins.insights_error ?? "a Meta não respondeu");
      const ideal = a.cpaTarget as number;
      const cpa = ins.cost_per_result;
      if (cpa != null && cpa > ideal + diff) {
        findings.push({ check: "cpa_dia", acc: a, line: `CPA de hoje ${brl(cpa)} (ideal ${brl(ideal)}, +${brl(cpa - ideal)}) — ${label}`, dedupe: `cpa_dia:${a.id}:${day}:${variant}` });
      } else if (cpa == null && (ins.spend ?? 0) >= ideal + diff) {
        findings.push({ check: "cpa_dia", acc: a, line: `${brl(ins.spend)} hoje sem conversa (ideal ${brl(ideal)}) — ${label}`, dedupe: `cpa_dia:${a.id}:${day}:${variant}` });
      }
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- Saldo + erro de pagamento (1–2 pedidos pra todas as contas) ----------

export async function runSaldo(db: SupabaseClient, userId: string, token: string, accounts: Acc[], slot: string): Promise<CheckResult> {
  const findings: Finding[] = [];
  const day = todayBrt();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const { statuses } = await checkLowBalances(db as never, userId, token, { send: false, bypassCooldown: true });
  for (const s of statuses) {
    const a = byId.get(s.ad_account_id.replace(/^act_/, ""));
    if (!a || !s.low) continue;
    findings.push({
      check: "saldo",
      acc: a,
      line: `Saldo ${fmtCurrency(s.balance, s.currency)} (limite ${fmtCurrency(s.threshold, s.currency)})`,
      dedupe: `saldo:${a.id}:${day}:${slot}`,
    });
  }
  // Erro de pagamento: o status da conta já vem na mesma lista de contas (em memória por 60s — sem pedido extra).
  const metaAccounts = await getAdAccounts(token);
  const recent = await getRecentSends(db as never, userId);
  for (const m of metaAccounts) {
    const a = byId.get(m.account_id);
    if (!a) continue;
    const reason = paymentReason(m);
    if (reason && !recent.boleto.has(m.account_id)) {
      findings.push({ check: "saldo", acc: a, line: `Pagamento: ${reason}`, dedupe: `pagamento:${a.id}:${day}:${slot}` });
    }
  }
  return { findings, calls: 2, skipped: 0, errors: [] };
}

// ---------- Investimento mensal (ritmo) — só o backup da madrugada, sem Meta ----------

export async function runVerbaMensal(accounts: Acc[]): Promise<CheckResult> {
  const findings: Finding[] = [];
  const cal = calendarSP();
  if (cal.day < 2) return { findings, calls: 0, skipped: 0, errors: [] }; // dia 01: ainda não tem dia fechado no mês
  const list = accounts.filter((a) => a.monthly && a.monthly > 0);
  const stored = await readStoredDaysMany(
    list.map((a) => a.id),
    cal.monthStart,
    addDays(cal.today, -1),
  );
  for (const a of list) {
    const days = stored.get(a.id);
    if (!days || days.size === 0) continue; // sem backup dessa conta: não acusa
    let spent = 0;
    for (const d of days.values()) spent += d.spend;
    const r = ritmoOf(a.monthly, spent, cal);
    if (r.gap == null || Math.abs(r.gap) < RITMO_BAND) continue;
    const media = r.avg != null ? ` · média ${brl(r.avg)}/dia, meta ${brl(r.dailyTarget ?? 0)}/dia` : "";
    findings.push({
      check: "verba_mensal",
      acc: a,
      line: r.gap > 0 ? `Falta investir ${brl(r.gap)} pra ficar em dia${media}` : `Passou ${brl(-r.gap)} da meta até ontem${media}`,
      dedupe: `verba_mensal:${a.id}:${cal.today}`,
    });
  }
  return { findings, calls: 0, skipped: 0, errors: [] };
}

// ---------- Investimento diário baixo (orçamento ligado ≤ 55% do Ritmo) ----------
// Etapa 258: versão leve — 2 pedidos por conta (antes 4): os conjuntos ativos já trazem o orçamento deles e o da
// campanha (CBO) no mesmo pedido, e o gasto do mês vem do backup (até ontem) + 1 pedido com o gasto de hoje.
// Mesma regra de sempre: conta só conjunto ativo com anúncio ativo, campanha ativa e não encerrada, fora [VAGA].

interface BudgetAdset {
  id: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string; created_time?: string; effective_status?: string };
  ads?: { data?: Array<{ id: string }> };
}
const ended = (t?: string) => !!t && new Date(t).getTime() <= Date.now();

export async function runVerbaDiaria(token: string, accounts: Acc[], deadline: number): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const day = todayBrt();
  const cal = calendarSP();
  const list = accounts.filter((a) => a.monthly && a.monthly > 0);
  const stored = cal.day > 1 ? await readStoredDaysMany(list.map((a) => a.id), cal.monthStart, addDays(cal.today, -1)) : new Map();

  const skipped = await eachAccount(
    list,
    deadline,
    async (a) => {
      const days = stored.get(a.id);
      if (cal.day > 1 && (!days || days.size === 0)) throw new Error("sem backup do mês (rode o backup das métricas)");
      let spent = 0;
      for (const d of days?.values() ?? []) spent += d.spend;

      const [adsets, ins] = await Promise.all([
        metaGetAll<BudgetAdset>(
          token,
          `/${act(a.id)}/adsets`,
          {
            fields:
              "id,daily_budget,lifetime_budget,start_time,end_time,created_time,campaign{id,name,daily_budget,lifetime_budget,start_time,stop_time,created_time,effective_status},ads.effective_status(['ACTIVE']).limit(1){id}",
            effective_status: JSON.stringify(["ACTIVE"]),
            limit: "200",
          },
          3,
        ),
        metaGet<{ data?: Array<{ campaign_name?: string; spend?: string }> }>(token, `/${act(a.id)}/insights`, {
          level: "campaign",
          fields: "campaign_name,spend",
          date_preset: "today",
          limit: "200",
        }),
      ]);
      calls += 2;
      for (const r of ins.data ?? []) if (!isJobCampaign(r.campaign_name)) spent += Number(r.spend ?? 0);

      let daily = 0;
      const cboDone = new Set<string>();
      for (const s of adsets) {
        const c = s.campaign ?? {};
        if ((s.ads?.data?.length ?? 0) === 0) continue;
        if (String(c.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
        if (ended(c.stop_time) || ended(s.end_time)) continue;
        if (isJobCampaign(c.name)) continue;
        if (Number(c.daily_budget) > 0 || Number(c.lifetime_budget) > 0) {
          if (!c.id || cboDone.has(c.id)) continue;
          cboDone.add(c.id);
          daily += Number(c.daily_budget) > 0 ? Number(c.daily_budget) / 100 : lifetimeToDailyEquivalent(c.lifetime_budget, c.start_time, c.stop_time, c.created_time);
        } else if (Number(s.daily_budget) > 0) {
          daily += Number(s.daily_budget) / 100;
        } else if (Number(s.lifetime_budget) > 0) {
          daily += lifetimeToDailyEquivalent(s.lifetime_budget, s.start_time, s.end_time, s.created_time);
        }
      }

      const rit = ritmo(a.monthly, spent);
      if (rit == null || !isBudgetAtMostRatioOfRitmo(daily, rit)) return;
      findings.push({
        check: "verba_diaria",
        acc: a,
        line: `Invest. diário ${brl(daily)} · Ritmo ${brl(rit)} (${rit > 0 ? Math.round((daily / rit) * 100) : 0}%)`,
        dedupe: `verba_diaria:${a.id}:${day}`,
      });
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- Conta sem entrega ----------

export async function runSemEntrega(token: string, accounts: Acc[], deadline: number, slot: string): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const hour = Number(slot.slice(0, 2));
  const day = todayBrt();
  const skipped = await eachAccount(
    accounts,
    deadline,
    async (a) => {
      const ads = await metaGet<{ data?: Array<{ id: string }> }>(token, `/${act(a.id)}/ads`, {
        fields: "id",
        limit: "1",
        filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
      });
      calls++;
      const activeAds = ads.data?.length ?? 0;
      let spend = 0;
      let impressions = 0;
      if (activeAds > 0) {
        const ins = await metaGet<{ data?: Array<{ spend?: string; impressions?: string }> }>(token, `/${act(a.id)}/insights`, {
          fields: "spend,impressions",
          date_preset: "today",
        });
        calls++;
        spend = Number(ins.data?.[0]?.spend ?? 0);
        impressions = Number(ins.data?.[0]?.impressions ?? 0);
      }
      const problem = classifyDelivery({ activeAds, spendToday: spend, impressionsToday: impressions, hour });
      if (problem) findings.push({ check: "sem_entrega", acc: a, line: PROBLEM_TEXT[problem], dedupe: `sem_entrega:${a.id}:${day}:${problem}` });
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- Erros de veiculação (só os anúncios com erro; 1 pedido por conta) ----------

const AD_ERRORS: Record<string, string> = {
  DISAPPROVED: "reprovado",
  WITH_ISSUES: "com problemas",
  PENDING_BILLING_INFO: "pendência de cobrança",
};

export async function runErros(token: string, accounts: Acc[], deadline: number): Promise<CheckResult> {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const day = todayBrt();
  const skipped = await eachAccount(
    accounts,
    deadline,
    async (a) => {
      const ads = await metaGetAll<{
        id: string;
        name?: string;
        effective_status?: string;
        issues_info?: Array<{ error_summary?: string; error_message?: string }>;
        adset?: { name?: string; effective_status?: string };
        campaign?: { effective_status?: string };
      }>(
        token,
        `/${act(a.id)}/ads`,
        {
          fields: "id,name,effective_status,issues_info{error_summary,error_message},adset{name,effective_status},campaign{effective_status}",
          effective_status: JSON.stringify(Object.keys(AD_ERRORS)),
          limit: "200",
        },
        2,
      );
      calls++;
      for (const ad of ads) {
        if (String(ad.campaign?.effective_status ?? "").toUpperCase() !== "ACTIVE") continue;
        if (String(ad.adset?.effective_status ?? "").toUpperCase() !== "ACTIVE") continue;
        const st = String(ad.effective_status ?? "").toUpperCase();
        const label = AD_ERRORS[st];
        if (!label) continue;
        const detail = (ad.issues_info ?? []).map((i) => i.error_summary || i.error_message || "").filter(Boolean)[0];
        findings.push({
          check: "erros",
          acc: a,
          line: `${ad.name || ad.id} (${ad.adset?.name ?? "conjunto"}): ${label}${detail ? ` — ${detail.slice(0, 120)}` : ""}`,
          dedupe: `erros:${ad.id}:${st}:${day}`,
        });
      }
    },
    errors,
  );
  return { findings, calls, skipped, errors };
}

// ---------- Prioridade (CPA dos últimos 3 dias, sem hoje) + Asana ----------
// Mesma regra da antiga "Prioridade em massa" (lib/alerts/bulk-status-update.ts): grava a prioridade, reordena o quadro
// e manda pro campo Prioridade do Asana. Os dias fechados vêm do backup — praticamente sem pedido à Meta.
export async function runPrioridade(db: SupabaseClient, userId: string, token: string, accounts: Acc[]): Promise<CheckResult> {
  const findings: Finding[] = [];
  const day = todayBrt();
  const { results, asana } = await checkAndUpdateBulkStatus(db as never, userId, token, { send: true, notify: false });
  const opts = await getPriorityOptions(db as never, userId);
  const label = (id?: string | null) => (id ? (opts.find((o) => o.id === id)?.label ?? id) : "sem prioridade");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byName = new Map(accounts.map((a) => [normName(a.name), a]));
  for (const r of results) {
    if (r.outcome !== "updated") continue;
    const a = byId.get(String(r.accountId).replace(/^act_/, ""));
    if (a) findings.push({ check: "prioridade", acc: a, line: `Prioridade: ${label(r.from)} → ${label(r.to)}`, dedupe: `prioridade:${a.id}:${day}` });
  }
  const asanaIssue = (names: string[], txt: string) => {
    for (const n of names) {
      const a = byName.get(normName(n));
      if (a) findings.push({ check: "prioridade", acc: a, line: `Asana: ${txt}`, dedupe: `prioridade-asana:${a.id}:${day}` });
    }
  };
  if (asana) {
    asanaIssue(asana.notFound, "não achei a tarefa com esse nome (confira o nome do cliente)");
    asanaIssue(asana.ambiguous, "mais de uma tarefa parecida — não mexi");
  }
  return { findings, calls: 0, skipped: 0, errors: asana?.errors ?? [] };
}
