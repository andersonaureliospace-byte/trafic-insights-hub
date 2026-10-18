// Ofertas ativas — retrato FIXO guardado no Supabase (tabela genérica meta_insights_cache, chave "offers_snapshot").
// Quem grava: a automação (hook offers-tick, ~5h20 e ~12h00 pelo n8n) e o botão ↻ da aba Descrição. A tela só LÊ daqui.

import type { createClient } from "@/lib/supabase/server";
import type { OffersSummary } from "@/lib/offers/rule";

type Db = Awaited<ReturnType<typeof createClient>>;

const KEY = "offers_snapshot";

export interface OffersSnapshot {
  // id da conta (sem "act_") → resumo + quando foi calculado (ISO)
  accounts: Record<string, { at: string; summary: OffersSummary }>;
}

export async function readOffersSnapshot(db: Db, userId: string): Promise<OffersSnapshot> {
  try {
    const { data, error } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", KEY).maybeSingle();
    if (error) throw error;
    const accounts = (data?.payload as OffersSnapshot | undefined)?.accounts;
    return { accounts: accounts && typeof accounts === "object" ? accounts : {} };
  } catch (e) {
    console.error("offers snapshot read err", (e as Error).message);
    return { accounts: {} };
  }
}

// Mescla as contas recalculadas no retrato existente (as que falharam ficam como estavam).
export async function saveOffersSnapshot(db: Db, userId: string, fresh: Record<string, OffersSummary>): Promise<string> {
  const at = new Date().toISOString();
  const cur = await readOffersSnapshot(db, userId);
  for (const [id, summary] of Object.entries(fresh)) cur.accounts[id.replace(/^act_/, "")] = { at, summary };
  const { error } = await db
    .from("meta_insights_cache")
    .upsert(
      { user_id: userId, cache_key: KEY, payload: cur, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
      { onConflict: "user_id,cache_key" },
    );
  if (error) throw error;
  return at;
}
