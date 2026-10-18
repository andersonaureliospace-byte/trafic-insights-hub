// Contas que precisam de atenção — retrato guardado no Supabase (tabela genérica meta_insights_cache, chave "attention_accounts").
// Quem grava: o Resumo das 7h (hook morning-summary-tick e a prévia/envio manual). O Painel só LÊ daqui (🚨 na frente do nome + filtro "Atenção"),
// então o que aparece marcado no Painel é exatamente a lista do resumo (mesma pontuação, mesmo mínimo — lib/alerts/priority-score.ts).

import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

const KEY = "attention_accounts";

export interface AttentionSnapshot {
  at: string | null; // quando o resumo foi calculado (ISO)
  accounts: Record<string, { points: number; reasons: string[] }>; // id da conta (sem "act_")
}

export async function readAttentionSnapshot(db: Db, userId: string): Promise<AttentionSnapshot> {
  try {
    const { data, error } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", KEY).maybeSingle();
    if (error) throw error;
    const p = data?.payload as Partial<AttentionSnapshot> | undefined;
    return { at: typeof p?.at === "string" ? p.at : null, accounts: p?.accounts && typeof p.accounts === "object" ? p.accounts : {} };
  } catch (e) {
    console.error("attention snapshot read err", (e as Error).message);
    return { at: null, accounts: {} };
  }
}

export async function saveAttentionSnapshot(
  db: Db,
  userId: string,
  ranked: Array<{ id?: string; points: number; reasons: string[] }>,
): Promise<void> {
  const accounts: AttentionSnapshot["accounts"] = {};
  for (const r of ranked) if (r.id) accounts[r.id.replace(/^act_/, "")] = { points: r.points, reasons: r.reasons };
  const payload: AttentionSnapshot = { at: new Date().toISOString(), accounts };
  const { error } = await db
    .from("meta_insights_cache")
    .upsert(
      { user_id: userId, cache_key: KEY, payload, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
      { onConflict: "user_id,cache_key" },
    );
  if (error) throw error;
}
