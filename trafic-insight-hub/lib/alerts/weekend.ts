// Fim de semana mais flexível + Standby (Etapa 158).
//
// Sábado e domingo (fuso de Brasília) a queda de investimento é grande, então a ordem das medidas muda:
//   1º reduz o orçamento diário do conjunto pra R$10 (o conjunto entra em "standby", mantendo os criativos);
//   2º se 6h depois continua acima da meta, pausa o CRIATIVO que está caro;
//   3º se ainda não melhorou, pausa o CONJUNTO (as regras de sempre: criado há 48h+, algum criativo já pausado…).
// Além disso, sábado e domingo de madrugada os conjuntos de bom desempenho (CPA dos 7 dias abaixo da meta) ou com mais
// de 3 dias ativos vão pra standby (R$10). Segunda 05h todos os que estão em standby voltam pra R$15 e saem da tela Standby.
// Estado: tabela weekend_standby (supabase/migrations/0034_pause_backup_and_standby.sql).

import type { createClient } from "@/lib/supabase/server";
import { getAdSetBudgetInfo, setAdSetDailyBudget, STANDBY_BUDGET_CENTS } from "@/lib/meta/budget";

type Db = Awaited<ReturnType<typeof createClient>>;

// Espera entre "reduziu o orçamento" e "pode pausar criativo/conjunto" (2 rodadas de 3h).
export const STANDBY_STEP_WAIT_MS = 6 * 60 * 60 * 1000;

export function isWeekendBR(now: Date = new Date()): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return wd === "Sat" || wd === "Sun";
}

export interface StandbyRecord {
  adset_id: string;
  ad_account_id: string;
  client_name: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  kind: "standby" | "no_cut";
  reason: string | null;
  from_budget: number | null;
  to_budget: number | null;
  started_at: string;
}

const COLS = "adset_id, ad_account_id, client_name, adset_name, campaign_id, kind, reason, from_budget, to_budget, started_at";

// Conjuntos em standby agora (ainda não liberados na segunda).
export async function loadStandby(db: Db, userId: string): Promise<Map<string, StandbyRecord>> {
  const { data, error } = await db.from("weekend_standby").select(COLS).eq("user_id", userId).is("released_at", null);
  if (error) {
    throw new Error(`Standby indisponível (${error.message}). Rode a migration 0034_pause_backup_and_standby.sql no Supabase.`);
  }
  const map = new Map<string, StandbyRecord>();
  for (const r of data ?? []) {
    map.set(r.adset_id as string, {
      ...(r as unknown as StandbyRecord),
      from_budget: r.from_budget != null ? Number(r.from_budget) : null,
      to_budget: r.to_budget != null ? Number(r.to_budget) : null,
    });
  }
  return map;
}

// Já passou tempo suficiente desde a redução pra seguir pro próximo passo (pausar criativo/conjunto)?
export function standbyStepDone(rec: StandbyRecord | undefined, now: Date = new Date()): boolean {
  if (!rec) return false;
  return now.getTime() - new Date(rec.started_at).getTime() >= STANDBY_STEP_WAIT_MS;
}

export interface StandbyInput {
  adset_id: string;
  ad_account_id: string;
  client_name: string;
  adset_name: string;
  reason: string;
}

export type StandbyOutcome =
  | { kind: "standby"; from: number; to: number }
  | { kind: "no_cut"; why: string }
  | { kind: "error"; error: string };

// Passo 1: reduz o orçamento diário do conjunto (ABO) pra R$10 e registra o standby. CBO, orçamento vitalício
// ou já em R$10 ou menos: não reduz, mas registra "no_cut" (o passo 1 conta como cumprido, e o conjunto aparece na tela).
// Erro na Meta: não registra (tenta de novo na próxima rodada).
export async function putAdsetOnStandby(db: Db, userId: string, token: string, input: StandbyInput): Promise<StandbyOutcome> {
  const infoRes = await getAdSetBudgetInfo(token, input.adset_id);
  let rec: { kind: "standby" | "no_cut"; campaign_id: string | null; from: number | null; to: number | null; outcome: StandbyOutcome };
  if (!infoRes.ok) {
    if (infoRes.reason === "error") return { kind: "error", error: infoRes.error };
    rec = { kind: "no_cut", campaign_id: infoRes.campaignId ?? null, from: null, to: null, outcome: { kind: "no_cut", why: infoRes.error } };
  } else if (infoRes.info.scope === "campaign") {
    rec = {
      kind: "no_cut",
      campaign_id: infoRes.info.campaignId,
      from: infoRes.info.currentCents / 100,
      to: null,
      outcome: { kind: "no_cut", why: "orçamento na campanha (CBO) — não mexo" },
    };
  } else if (infoRes.info.currentCents <= STANDBY_BUDGET_CENTS) {
    rec = {
      kind: "no_cut",
      campaign_id: infoRes.info.campaignId,
      from: infoRes.info.currentCents / 100,
      to: infoRes.info.currentCents / 100,
      outcome: { kind: "no_cut", why: "já está em R$10 ou menos" },
    };
  } else {
    const res = await setAdSetDailyBudget(token, input.adset_id, STANDBY_BUDGET_CENTS);
    if (!res.ok) return { kind: "error", error: res.error };
    rec = {
      kind: "standby",
      campaign_id: infoRes.info.campaignId,
      from: infoRes.info.currentCents / 100,
      to: STANDBY_BUDGET_CENTS / 100,
      outcome: { kind: "standby", from: infoRes.info.currentCents / 100, to: STANDBY_BUDGET_CENTS / 100 },
    };
  }
  const { error } = await db.from("weekend_standby").upsert(
    {
      user_id: userId,
      adset_id: input.adset_id,
      ad_account_id: input.ad_account_id,
      client_name: input.client_name,
      adset_name: input.adset_name,
      campaign_id: rec.campaign_id,
      kind: rec.kind,
      reason: input.reason,
      from_budget: rec.from,
      to_budget: rec.to,
      started_at: new Date().toISOString(),
      released_at: null,
      resume_budget: null,
    },
    { onConflict: "user_id,adset_id" },
  );
  if (error) console.error("weekend_standby upsert err", error.message);
  return rec.outcome;
}
