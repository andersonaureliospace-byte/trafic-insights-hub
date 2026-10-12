// Quarentena de 24h da pausa automática de Conjuntos (Etapa 99) — ver
// supabase/migrations/0027_adset_quarantine.sql e lib/alerts/adsets-pause.ts.

import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export const QUARANTINE_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // registro vencido há mais que isso é apagado

export interface QuarantineRecord {
  adset_id: string;
  ad_account_id: string;
  campaign_id: string | null;
  budget_scope: "adset" | "campaign";
  quarantine_until: string;
  cuts: number;
}

export async function loadQuarantine(db: Db, userId: string): Promise<Map<string, QuarantineRecord>> {
  const { data, error } = await db
    .from("adset_quarantine")
    .select("adset_id, ad_account_id, campaign_id, budget_scope, quarantine_until, cuts")
    .eq("user_id", userId);
  if (error) {
    // Sem a tabela (migration 0027 não rodada) NÃO segue: cortaria orçamento sem ter onde
    // registrar a quarentena e cortaria de novo a cada verificação.
    throw new Error(
      `Quarentena de conjuntos indisponível (${error.message}). Rode a migration 0027_adset_quarantine.sql no Supabase.`,
    );
  }
  const map = new Map<string, QuarantineRecord>();
  for (const r of data ?? []) map.set(r.adset_id as string, r as QuarantineRecord);

  // Faxina: registro vencido há mais de 3 dias (conjunto que saiu do ar, por ex.).
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const stale = [...map.values()].filter((r) => r.quarantine_until < staleBefore).map((r) => r.adset_id);
  if (stale.length > 0) {
    await db.from("adset_quarantine").delete().eq("user_id", userId).in("adset_id", stale);
    for (const id of stale) map.delete(id);
  }
  return map;
}

export async function saveQuarantine(
  db: Db,
  userId: string,
  rec: {
    adset_id: string;
    ad_account_id: string;
    campaign_id: string | null;
    budget_scope: "adset" | "campaign";
    cuts: number;
    from?: number | null;
    to?: number | null;
  },
  now: Date = new Date(),
): Promise<void> {
  await db.from("adset_quarantine").upsert(
    {
      user_id: userId,
      adset_id: rec.adset_id,
      ad_account_id: rec.ad_account_id,
      campaign_id: rec.campaign_id,
      budget_scope: rec.budget_scope,
      quarantine_until: new Date(now.getTime() + QUARANTINE_MS).toISOString(),
      cuts: rec.cuts,
      last_from_budget: rec.from ?? null,
      last_to_budget: rec.to ?? null,
      updated_at: now.toISOString(),
    },
    { onConflict: "user_id,adset_id" },
  );
}

export async function clearQuarantine(db: Db, userId: string, adsetIds: string[]): Promise<void> {
  if (adsetIds.length === 0) return;
  await db.from("adset_quarantine").delete().eq("user_id", userId).in("adset_id", adsetIds);
}
