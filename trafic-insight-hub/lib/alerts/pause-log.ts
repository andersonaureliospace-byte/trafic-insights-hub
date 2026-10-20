// Registro das pausas automáticas por desempenho (Etapa 158) — base do "backup": a rodada seguinte confere o que foi
// pausado nas últimas 6h e reativa quem ganhou conversa e voltou pra dentro do limite (a Meta atribui conversas com
// atraso). Tabela auto_pause_log (supabase/migrations/0034_pause_backup_and_standby.sql). Falha ao gravar/ler aqui
// NUNCA derruba a pausa em si: só deixa de ter backup daquele item.

import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export const BACKUP_WINDOW_MS = 6 * 60 * 60 * 1000;
const PURGE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export interface PauseLogEntry {
  id: string;
  entity_type: "adset" | "ad";
  entity_id: string;
  ad_account_id: string;
  client_name: string | null;
  entity_name: string | null;
  paused_at: string;
  spend_at_pause: number | null;
  conversations_at_pause: number | null;
  cpa_at_pause: number | null;
  reason: string | null;
}

export async function logAutoPauses(
  db: Db,
  userId: string,
  rows: Array<{
    entity_type: "adset" | "ad";
    entity_id: string;
    ad_account_id: string;
    client_name: string;
    entity_name: string;
    spend: number;
    conversations: number | null;
    cpa: number | null;
    reason: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await db.from("auto_pause_log").insert(
      rows.map((r) => ({
        user_id: userId,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        ad_account_id: r.ad_account_id,
        client_name: r.client_name,
        entity_name: r.entity_name,
        spend_at_pause: r.spend,
        conversations_at_pause: r.conversations ?? 0,
        cpa_at_pause: r.cpa,
        reason: r.reason,
      })),
    );
    if (error) throw error;
  } catch (e) {
    console.error("auto_pause_log insert err (sem backup desses itens — migration 0034 rodada?)", (e as Error).message);
  }
}

// Pausas das últimas 6h ainda não reativadas.
export async function loadPausesToReview(db: Db, userId: string, now: Date = new Date()): Promise<PauseLogEntry[]> {
  const since = new Date(now.getTime() - BACKUP_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("auto_pause_log")
    .select("id, entity_type, entity_id, ad_account_id, client_name, entity_name, paused_at, spend_at_pause, conversations_at_pause, cpa_at_pause, reason")
    .eq("user_id", userId)
    .is("reactivated_at", null)
    .gte("paused_at", since)
    .order("paused_at", { ascending: true });
  if (error) {
    throw new Error(`Registro das pausas indisponível (${error.message}). Rode a migration 0034_pause_backup_and_standby.sql no Supabase.`);
  }
  // Faxina das linhas velhas (melhor esforço).
  void db
    .from("auto_pause_log")
    .delete()
    .eq("user_id", userId)
    .lt("paused_at", new Date(now.getTime() - PURGE_AFTER_MS).toISOString())
    .then(() => undefined);
  return (data ?? []).map((r) => ({
    ...(r as unknown as PauseLogEntry),
    spend_at_pause: r.spend_at_pause != null ? Number(r.spend_at_pause) : null,
    cpa_at_pause: r.cpa_at_pause != null ? Number(r.cpa_at_pause) : null,
  }));
}

export async function markReactivated(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.from("auto_pause_log").update({ reactivated_at: new Date().toISOString(), reviewed_at: new Date().toISOString() }).eq("user_id", userId).in("id", ids);
}

// Pausa que já não vale revisar (alguém já reativou na mão, por ex.): sai da fila.
export async function markDone(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.from("auto_pause_log").update({ reactivated_at: new Date().toISOString(), reviewed_at: new Date().toISOString() }).eq("user_id", userId).in("id", ids);
}
