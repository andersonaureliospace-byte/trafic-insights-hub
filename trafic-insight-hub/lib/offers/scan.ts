// Ofertas ativas (Etapa 149) — busca na Meta o que existiu no MÊS CORRENTE em cada conta IVS e resume por tipo
// (regra em lib/offers/rule.ts). "Existiu" = conjunto com gasto no mês OU ligado agora (ativo/programado).

import type { createClient } from "@/lib/supabase/server";
import { metaGetAll, spDate } from "@/lib/meta/client";
import { isNonLeadResultType, leadResultOf } from "@/lib/meta/shared";
import { ACTIVE_ISH_STATUSES } from "@/lib/meta/insights";
import { namingAccounts } from "@/lib/naming/scan";
import { readOffersSnapshot, saveOffersSnapshot } from "@/lib/offers/snapshot";
import {
  offerKindOf,
  summarizeOffers,
  type OfferAdset,
  type OfferKind,
  type OfferMetric,
  type OffersMetrics,
  type OffersSummary,
} from "@/lib/offers/rule";

// YYYY-MM-DD ± n dias, só no calendário (UTC puro).
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

type InsightRow = {
  adset_id?: string;
  adset_name?: string;
  campaign_name?: string;
  spend?: string;
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type?: string; value?: string }>;
};

// Etapa 238: CPA por tipo de oferta nos 2 últimos dias fechados + gasto de PROMO no mês.
async function offersMetricsForAccount(token: string, act: string, monthRows: InsightRow[]): Promise<OffersMetrics> {
  const today = spDate(new Date());
  const until = addDaysYmd(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  // Etapa 242: só o mês atual (no dia 02, só o dia 01; no dia 01, nada).
  const since = addDaysYmd(today, -2) < monthStart ? monthStart : addDaysYmd(today, -2);
  const empty = (): OfferMetric => ({ spend: 0, results: 0 });
  const last2d: Record<OfferKind, OfferMetric> = { geral: empty(), exame: empty(), boleto: empty(), promo: empty() };
  const rows = since > until ? [] : await metaGetAll<InsightRow>(token, `/${act}/insights`, {
    fields: "adset_id,adset_name,campaign_name,spend,results,actions",
    level: "adset",
    time_range: JSON.stringify({ since, until }),
    use_unified_attribution_setting: "true",
    limit: "500",
  });
  for (const r of rows) {
    if (VAGA_RE.test(r.campaign_name ?? "")) continue;
    const kind = offerKindOf(r.adset_name ?? "");
    if (!kind) continue;
    last2d[kind].spend += Number(r.spend) || 0;
    const lr = leadResultOf(r.results, r.actions);
    if (!isNonLeadResultType(lr.type) && lr.value != null) last2d[kind].results += lr.value;
  }
  let promoSpendMonth = 0;
  for (const r of monthRows) {
    if (VAGA_RE.test(r.campaign_name ?? "")) continue;
    if (offerKindOf(r.adset_name ?? "") === "promo") promoSpendMonth += Number(r.spend) || 0;
  }
  return { last2d, promoSpendMonth, since, until };
}

type Db = Awaited<ReturnType<typeof createClient>>;

const VAGA_RE = /\bvaga\b/i;
const CONCURRENCY = 3;

export async function offersForAccount(token: string, adAccountId: string): Promise<OffersSummary> {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  // Etapa 254: "ligado agora" = conjunto ligado, sem data de término vencida E com pelo menos 1 anúncio ligado.
  // Antes bastava o conjunto estar ligado — conjunto com os anúncios todos pausados (ou já concluído) aparecia "Ativo".
  const [spent, live, liveAds] = await Promise.all([
    metaGetAll<{ adset_id?: string; adset_name?: string; campaign_name?: string; spend?: string }>(token, `/${act}/insights`, {
      fields: "adset_id,adset_name,campaign_name,spend",
      level: "adset",
      date_preset: "this_month",
      limit: "500",
    }),
    metaGetAll<{ id: string; name?: string; end_time?: string; campaign?: { name?: string; stop_time?: string } }>(token, `/${act}/adsets`, {
      fields: "id,name,end_time,campaign{name,stop_time}",
      limit: "200",
      filtering: JSON.stringify([{ field: "adset.effective_status", operator: "IN", value: ACTIVE_ISH_STATUSES }]),
    }),
    metaGetAll<{ adset_id?: string }>(token, `/${act}/ads`, {
      fields: "adset_id",
      limit: "500",
      filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ACTIVE_ISH_STATUSES }]),
    }),
  ]);
  const adsetsWithActiveAd = new Set(liveAds.map((a) => a.adset_id).filter(Boolean) as string[]);
  const ended = (t?: string) => {
    if (!t || t === "0") return false;
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms <= Date.now();
  };

  const byId = new Map<string, OfferAdset>();
  for (const r of spent) {
    if (!r.adset_id || VAGA_RE.test(r.campaign_name ?? "")) continue;
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    byId.set(r.adset_id, { name: r.adset_name ?? "", active: false, spend });
  }
  for (const a of live) {
    if (VAGA_RE.test(a.campaign?.name ?? "")) continue;
    if (!adsetsWithActiveAd.has(a.id) || ended(a.end_time) || ended(a.campaign?.stop_time)) continue; // não está rodando de verdade
    const cur = byId.get(a.id);
    if (cur) cur.active = true;
    else byId.set(a.id, { name: a.name ?? "", active: true, spend: 0 });
  }
  const summary = summarizeOffers([...byId.values()]);
  try {
    summary.metrics = await offersMetricsForAccount(token, act, spent);
  } catch (e) {
    // Sem os números, o status das ofertas continua valendo (a tela mostra "—" no CPA).
    console.error("offers metrics err", act, (e as Error).message);
  }
  return summary;
}

export interface OffersResult {
  offers: Record<string, OffersSummary>;
  failed: string[];
  notIvs: string[];
}

// Só contas IVS exibidas e ativas (o padrão de nomes é delas). Outras contas voltam em notIvs.
export async function offersForAccounts(db: Db, userId: string, token: string, requested: string[]): Promise<OffersResult> {
  const ivs = await namingAccounts(db, userId);
  const ivsIds = new Set(ivs.map((a) => a.ad_account_id.replace(/^act_/, "")));
  const wanted = requested.map((id) => id.replace(/^act_/, ""));
  const todo = wanted.filter((id) => ivsIds.has(id));
  const notIvs = wanted.filter((id) => !ivsIds.has(id));
  const offers: Record<string, OffersSummary> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      try {
        offers[id] = await offersForAccount(token, id);
      } catch (e) {
        console.error("offers err", id, (e as Error).message);
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { offers, failed, notIvs };
}

// Automação (hook offers-tick): recalcula as contas IVS cujo retrato tem mais de STALE_HOURS horas e grava no Supabase,
// em lotes (salva a cada lote). Se o prazo da função acabar, o que sobrou fica pra próxima chamada (o n8n repete a cada 6 min).
const STALE_HOURS = 3;

export interface OffersTickResult {
  done: number;
  failed: string[];
  pending: number;
  total: number;
}

export async function runOffersTick(
  db: Db,
  userId: string,
  token: string,
  opts: { force?: boolean; deadlineMs?: number } = {},
): Promise<OffersTickResult> {
  const ivs = (await namingAccounts(db, userId)).map((a) => a.ad_account_id.replace(/^act_/, ""));
  const snap = await readOffersSnapshot(db, userId);
  const limit = Date.now() - STALE_HOURS * 60 * 60 * 1000;
  const todo = ivs.filter((id) => {
    if (opts.force) return true;
    const at = snap.accounts[id]?.at;
    return !at || Date.parse(at) < limit;
  });
  let done = 0;
  const failed: string[] = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const batch = todo.slice(i, i + CONCURRENCY);
    const fresh: Record<string, OffersSummary> = {};
    await Promise.all(
      batch.map(async (id) => {
        try {
          fresh[id] = await offersForAccount(token, id);
        } catch (e) {
          console.error("offers tick err", id, (e as Error).message);
          failed.push(id);
        }
      }),
    );
    if (Object.keys(fresh).length > 0) {
      await saveOffersSnapshot(db, userId, fresh);
      done += Object.keys(fresh).length;
    }
  }
  return { done, failed, pending: Math.max(0, todo.length - done - failed.length), total: ivs.length };
}
