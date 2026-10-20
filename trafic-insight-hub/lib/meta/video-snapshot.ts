// Retrato fixo dos vídeos de GERAL (Etapa 161). A tela Análise → Vídeos NÃO consulta a Meta ao abrir: lê este retrato, que guarda os
// números até ONTEM (dia fechado) e é refeito de madrugada pelo hook videos-tick (ou pelo botão "Atualizar" da tela).
// Fica em meta_insights_cache (chave `videos_geral:v1`), um registro por usuário com todas as contas dentro.

import type { createClient } from "@/lib/supabase/server";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { todayBrt } from "./daily-range";
import { getAccountVideoStats, type AccountVideoStat } from "./video-map";

type Db = Awaited<ReturnType<typeof createClient>>;

const KEY = "videos_geral:v1";
const BATCH = 5;

export interface SnapshotAccount {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  stats: AccountVideoStat[];
  computedFor: string; // YYYY-MM-DD (Brasília) do dia do cálculo — os números vão até o dia anterior
  error?: string;
}

export interface VideoSnapshot {
  computed_at: string;
  accounts: Record<string, SnapshotAccount>;
}

export async function readVideoSnapshot(db: Db, userId: string): Promise<VideoSnapshot | null> {
  const { data, error } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", KEY).maybeSingle();
  if (error) throw error;
  return (data?.payload as VideoSnapshot | undefined) ?? null;
}

// Junta o resultado de algumas contas ao retrato guardado (as outras contas ficam como estavam).
export async function saveSnapshotAccounts(db: Db, userId: string, entries: SnapshotAccount[]): Promise<void> {
  if (entries.length === 0) return;
  const cur = (await readVideoSnapshot(db, userId)) ?? { computed_at: new Date().toISOString(), accounts: {} };
  for (const e of entries) cur.accounts[e.accountId] = e;
  cur.computed_at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const { error } = await db
    .from("meta_insights_cache")
    .upsert({ user_id: userId, cache_key: KEY, payload: cur, expires_at: expiresAt }, { onConflict: "user_id,cache_key" });
  if (error) throw error;
}

// Calcula as contas pedidas (com meta cadastrada). Contas sem meta voltam em `skipped`.
export async function computeAccounts(
  db: Db,
  userId: string,
  token: string,
  accountIds: string[],
): Promise<{ entries: SnapshotAccount[]; skipped: { accountId: string; clientName: string }[] }> {
  const off = await inactiveAccountIds(db, userId);
  const ids = accountIds.filter((id) => !off.has(id));
  if (ids.length === 0) return { entries: [], skipped: [] };
  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", ids);
  const map = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));
  const today = todayBrt();
  const entries: SnapshotAccount[] = [];
  const skipped: { accountId: string; clientName: string }[] = [];
  await Promise.all(
    ids.map(async (accountId) => {
      const b = map.get(accountId);
      const clientName = (b?.client_name as string | null) || accountId;
      const cpaTarget = (b?.cpa_target as number | null) ?? null;
      if (!cpaTarget) {
        skipped.push({ accountId, clientName });
        return;
      }
      try {
        entries.push({ accountId, clientName, cpaTarget, stats: await getAccountVideoStats(token, accountId), computedFor: today });
      } catch (e) {
        entries.push({ accountId, clientName, cpaTarget, stats: [], computedFor: today, error: (e as Error).message });
      }
    }),
  );
  return { entries, skipped };
}

// Usado pelo hook da madrugada: refaz as contas cujo retrato não é de hoje, até acabar o prazo (chamar de novo continua de onde parou).
export async function refreshVideoSnapshotForUser(
  db: Db,
  userId: string,
  token: string,
  opts: { force?: boolean; deadlineMs: number },
): Promise<{ done: number; pending: number }> {
  const { data: bindings, error } = await db.from("account_bindings").select("ad_account_id").eq("user_id", userId).not("cpa_target", "is", null);
  if (error) throw error;
  const off = await inactiveAccountIds(db, userId);
  const all = (bindings ?? []).map((b) => b.ad_account_id as string).filter((id) => !off.has(id));
  const snap = await readVideoSnapshot(db, userId);
  const today = todayBrt();
  const todo = all.filter((id) => opts.force || !snap?.accounts[id] || snap.accounts[id].computedFor !== today || snap.accounts[id].error);
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() > opts.deadlineMs - 15_000) break;
    const { entries } = await computeAccounts(db, userId, token, todo.slice(i, i + BATCH));
    await saveSnapshotAccounts(db, userId, entries);
    done += entries.length;
  }
  return { done, pending: Math.max(0, todo.length - done) };
}
