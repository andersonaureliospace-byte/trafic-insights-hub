// Etapa 125: backup diário das métricas por conta no Supabase (tabela meta_daily_metrics, migration 0030).
// - leitura (readStoredDays/planFromStore): usada por getAccountInsight e pelo CPA diário — dias fechados
//   vêm daqui, a Meta só responde "hoje" (ou o que faltar). Qualquer falha aqui => devolve null/vazio e o
//   caminho antigo (Meta direto) continua valendo: o backup nunca derruba a tela.
// - escrita (syncAccountDays/syncAccounts): rotina noturna (hook metrics-sync-tick) refaz os últimos 37
//   dias de cada conta (pega conversa atribuída depois) e apaga o que passou de 37 dias — é o "reset" da
//   virada do mês: janela móvel, nunca fica sem os últimos dias.
// Só o servidor usa (service role, RLS sem policy).

import { createServiceClient } from "@/lib/supabase/server";
import { metaGet, metaGetAll, type DateRangeInput } from "./client";
import { isJobCampaign, isVaga, EXCLUDED_OBJECTIVES, pickFirstNumeric } from "./shared";
import {
  STORE_DAYS,
  addDaysYmd,
  buildDayRows,
  isSuspectDay,
  oldestKeptDay,
  planRange,
  resolveRange,
  todayBrt,
  type CampaignDayInput,
  type DayRow,
  type RangePlan,
  type YmdRange,
} from "./daily-range";

export { STORE_DAYS };

const TABLE = "meta_daily_metrics";

export function normAccountId(actId: string): string {
  return actId.replace(/^act_/, "");
}

function storeAvailable(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

interface DbRow {
  ad_account_id: string;
  day: string;
  spend: number | string;
  cpa_spend: number | string;
  results: number | string;
  result_types: string[] | null;
}

function toDayRow(r: DbRow): DayRow {
  return {
    day: r.day,
    spend: Number(r.spend) || 0,
    cpaSpend: Number(r.cpa_spend) || 0,
    results: Number(r.results) || 0,
    types: r.result_types ?? [],
  };
}

// Dias guardados de VÁRIAS contas de uma vez (uma consulta só).
export async function readStoredDaysMany(
  accountIds: string[],
  since: string,
  until: string,
): Promise<Map<string, Map<string, DayRow>>> {
  const out = new Map<string, Map<string, DayRow>>();
  if (!storeAvailable() || accountIds.length === 0 || since > until) return out;
  try {
    const db = createServiceClient();
    const ids = accountIds.map(normAccountId);
    // Em lotes de 20 contas: o Supabase corta respostas em ~1000 linhas, e 20 contas x 39 dias cabem.
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const { data, error } = await db
        .from(TABLE)
        .select("ad_account_id, day, spend, cpa_spend, results, result_types")
        .in("ad_account_id", chunk)
        .gte("day", since)
        .lte("day", until)
        .limit(chunk.length * (STORE_DAYS + 2));
      if (error) throw error;
      for (const r of (data ?? []) as DbRow[]) {
        const row = toDayRow(r);
        // Etapa 178: dia gravado com resultados mas sem gasto = cópia ruim; ignora (a Meta responde no lugar) até a rotina noturna refazer.
        if (isSuspectDay(row)) continue;
        const m = out.get(r.ad_account_id) ?? new Map<string, DayRow>();
        m.set(r.day, row);
        out.set(r.ad_account_id, m);
      }
    }
  } catch (e) {
    console.error("daily-store read err (usa a Meta direto)", (e as Error).message);
    return new Map();
  }
  return out;
}

// Plano de um período pra uma conta: o que vem do backup e o que ainda é perguntado à Meta.
// null = não dá pra usar o backup (período desconhecido, conta sem nada guardado, banco fora do ar).
export async function planFromStore(actId: string, preset: DateRangeInput): Promise<RangePlan | null> {
  const today = todayBrt();
  const range = resolveRange(preset as string | YmdRange, today);
  if (!range) return null;
  const closedUntil = range.until < today ? range.until : addDaysYmd(today, -1);
  if (range.since > closedUntil) return null; // só hoje: nada a buscar no backup
  const many = await readStoredDaysMany([actId], range.since, closedUntil);
  const stored = many.get(normAccountId(actId));
  if (!stored || stored.size === 0) return null;
  const plan = planRange(range, today, stored);
  return plan.used.length > 0 ? plan : null;
}

// ---------------------------------------------------------------- escrita (rotina noturna)

// Etapa 178: confere o que a Meta devolveu antes de gravar. Se algum dia veio com resultados e sem gasto (a Meta às vezes
// devolve a linha sem o `spend`), tenta de novo uma vez; se continuar assim, esses dias NÃO são gravados (ficam sem cópia e a
// tela pergunta à Meta por eles) — os outros dias gravam normalmente.
async function fetchAccountDays(token: string, actId: string, range: YmdRange): Promise<DayRow[]> {
  let rows = await fetchAccountDaysOnce(token, actId, range);
  if (rows.some(isSuspectDay)) {
    await new Promise((r) => setTimeout(r, 2000));
    rows = await fetchAccountDaysOnce(token, actId, range);
  }
  const bad = rows.filter(isSuspectDay);
  if (bad.length > 0) console.warn(`daily-store: ${normAccountId(actId)} com ${bad.length} dia(s) sem gasto (ex.: ${bad[0].day}) — não gravados`);
  return rows.filter((r) => !isSuspectDay(r));
}

async function fetchAccountDaysOnce(token: string, actId: string, range: YmdRange): Promise<DayRow[]> {
  const id = `act_${normAccountId(actId)}`;
  // Objetivos fora do CPA: precisa da lista de campanhas (uma chamada). Se falhar, ABORTA — gravar sem
  // essa classificação misturaria seguidores/tráfego no CPA.
  const camps = await metaGetAll<{ id?: string; objective?: string }>(token, `/${id}/campaigns`, {
    fields: "id,objective",
    limit: "500",
  });
  const excluded = new Set<string>();
  for (const c of camps) if (c.id && c.objective && EXCLUDED_OBJECTIVES.has(c.objective)) excluded.add(c.id);

  const rows = await metaGetAll<{
    date_start?: string;
    campaign_id?: string;
    campaign_name?: string;
    spend?: string;
    results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  }>(token, `/${id}/insights`, {
    fields: "date_start,campaign_id,campaign_name,spend,results",
    time_range: JSON.stringify(range),
    time_increment: "1",
    level: "campaign",
    limit: "500",
    use_unified_attribution_setting: "true",
  });
  const inputs: CampaignDayInput[] = rows.map((r) => {
    const v = pickFirstNumeric(r.results);
    let type: string | null = null;
    if (v != null && v > 0) {
      const ind = r.results?.[0]?.indicator;
      if (ind) type = ind.includes(":") ? ind.split(":").slice(1).join(":") : ind;
    }
    return {
      date_start: r.date_start,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      spend: r.spend,
      resultValue: v,
      resultType: type,
    };
  });
  return buildDayRows(range, inputs, excluded, isJobCampaign, isVaga);
}

// Refaz [since, until] de UMA conta e grava (upsert). Se a Meta falhar, lança — nada é gravado.
export async function syncAccountDays(token: string, actId: string, range: YmdRange): Promise<number> {
  const rows = await fetchAccountDays(token, actId, range);
  const db = createServiceClient();
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    ad_account_id: normAccountId(actId),
    day: r.day,
    spend: r.spend,
    cpa_spend: r.cpaSpend,
    results: r.results,
    result_types: r.types,
    updated_at: now,
  }));
  const { error } = await db.from(TABLE).upsert(payload, { onConflict: "ad_account_id,day" });
  if (error) throw error;
  return payload.length;
}

export interface SyncReport {
  synced: string[];
  skipped: string[];
  failed: Array<{ account: string; error: string }>;
  pending: string[]; // sobrou tempo/limite — a próxima chamada continua
  pruned: boolean;
}

const SYNC_CONCURRENCY = 3;
const FRESH_HOURS = 6;

// Roda a rotina pra uma lista de contas: pula as que já foram refeitas há pouco (a rotina pode ser chamada
// 2x na madrugada pra terminar o que sobrou), respeita um prazo (a função da Vercel tem limite de tempo)
// e no fim apaga o que passou de 37 dias.
export async function syncAccounts(
  token: string,
  accountIds: string[],
  opts: { force?: boolean; deadlineMs?: number } = {},
): Promise<SyncReport> {
  const today = todayBrt();
  const range: YmdRange = { since: oldestKeptDay(today), until: addDaysYmd(today, -1) };
  const report: SyncReport = { synced: [], skipped: [], failed: [], pending: [], pruned: false };
  const ids = [...new Set(accountIds.map(normAccountId))];
  const db = createServiceClient();

  const fresh = new Set<string>();
  if (!opts.force && ids.length > 0) {
    const { data } = await db.from(TABLE).select("ad_account_id, updated_at").in("ad_account_id", ids).eq("day", range.until);
    const limit = Date.now() - FRESH_HOURS * 3600_000;
    // Só vale como "já feita" se o backup da conta está completo (todos os dias) E foi refeito há pouco.
    for (const r of (data ?? []) as Array<{ ad_account_id: string; updated_at: string }>) {
      if (Date.parse(r.updated_at) > limit) fresh.add(r.ad_account_id);
    }
  }

  const queue = ids.filter((id) => {
    if (fresh.has(id)) {
      report.skipped.push(id);
      return false;
    }
    return true;
  });
  const deadline = opts.deadlineMs ?? Date.now() + 50_000;
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (Date.now() > deadline) return;
      const id = queue[next++];
      try {
        await syncAccountDays(token, id, range);
        report.synced.push(id);
      } catch (e) {
        report.failed.push({ account: id, error: (e as Error).message.slice(0, 200) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, queue.length) }, worker));
  report.pending = queue.slice(next);

  // Poda: nada mais velho que a janela. Só quando não sobrou nada pendente (não apaga no meio do trabalho).
  if (report.pending.length === 0) {
    const { error } = await db.from(TABLE).delete().lt("day", range.since);
    report.pruned = !error;
  }
  return report;
}

// Usado pelos consumidores de CPA diário/mês: dias fechados de várias contas de uma vez.
export async function closedDaysFor(
  accountIds: string[],
  since: string,
  until: string,
): Promise<Map<string, Map<string, DayRow>>> {
  return readStoredDaysMany(accountIds, since, until);
}

// Reexporta pra quem só precisa da checagem "tem todos os dias fechados no período?".
export function hasAllClosedDays(stored: Map<string, DayRow> | undefined, since: string, until: string): boolean {
  if (!stored) return false;
  for (let d = since; d <= until; d = addDaysYmd(d, 1)) if (!stored.has(d)) return false;
  return true;
}
