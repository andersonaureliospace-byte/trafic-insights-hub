// Retrato fixo do "Melhor público" (Etapa 164) — mesma ideia do retrato de vídeos: a tela lê o que está guardado (números até ONTEM) e
// não consulta a Meta ao abrir. Refeito de madrugada pelo hook audience-tick (ou pelo botão "Atualizar agora").
// Fica em meta_insights_cache, chave `audience:v1`, um registro por usuário com todas as contas dentro.

import type { createClient } from "@/lib/supabase/server";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { todayBrt } from "./daily-range";
import { getAccountAudience } from "./audience-map";
import type { AudRow } from "./audience-summary";

type Db = Awaited<ReturnType<typeof createClient>>;

const KEY = "audience:v1";
const BATCH = 4;

export interface AudienceAccount {
  accountId: string;
  clientName: string;
  cpaTarget: number | null;
  rows: AudRow[]; // janela de 14 dias (também é o que os retratos antigos têm)
  windows?: Record<string, AudRow[]>; // Etapa 167: "7", "14" e "30" dias
  computedFor: string; // dia do cálculo (Brasília) — os números vão até o dia anterior
  error?: string;
}

export interface AudienceSnapshot {
  computed_at: string;
  accounts: Record<string, AudienceAccount>;
}

export async function readAudienceSnapshot(db: Db, userId: string): Promise<AudienceSnapshot | null> {
  const { data, error } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", KEY).maybeSingle();
  if (error) throw error;
  return (data?.payload as AudienceSnapshot | undefined) ?? null;
}

export async function saveAudienceAccounts(db: Db, userId: string, entries: AudienceAccount[]): Promise<void> {
  if (entries.length === 0) return;
  const cur = (await readAudienceSnapshot(db, userId)) ?? { computed_at: new Date().toISOString(), accounts: {} };
  for (const e of entries) cur.accounts[e.accountId] = e;
  cur.computed_at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const { error } = await db
    .from("meta_insights_cache")
    .upsert({ user_id: userId, cache_key: KEY, payload: cur, expires_at: expiresAt }, { onConflict: "user_id,cache_key" });
  if (error) throw error;
}

// Contas exibidas e ativas do usuário (com nome e meta de CPA, se houver).
export async function audienceAccounts(db: Db, userId: string): Promise<Array<{ accountId: string; clientName: string; cpaTarget: number | null }>> {
  const { data: selected, error } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (error) throw error;
  const off = await inactiveAccountIds(db, userId);
  const ids = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (ids.length === 0) return [];
  const { data: bindings, error: bErr } = await db.from("account_bindings").select("ad_account_id, client_name, cpa_target").eq("user_id", userId).in("ad_account_id", ids);
  if (bErr) throw bErr;
  return (bindings ?? [])
    .map((b) => ({
      accountId: b.ad_account_id as string,
      clientName: ((b.client_name as string | null) ?? "").trim() || (b.ad_account_id as string),
      cpaTarget: (b.cpa_target as number | null) ?? null,
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}

export async function computeAudienceAccounts(db: Db, userId: string, token: string, accountIds: string[]): Promise<AudienceAccount[]> {
  const known = new Map((await audienceAccounts(db, userId)).map((a) => [a.accountId, a]));
  const today = todayBrt();
  const out: AudienceAccount[] = [];
  await Promise.all(
    accountIds.map(async (id) => {
      const a = known.get(id);
      if (!a) return;
      try {
        const windows = await getAccountAudience(token, id);
        out.push({ ...a, rows: windows["14"] ?? [], windows, computedFor: today });
      } catch (e) {
        out.push({ ...a, rows: [], computedFor: today, error: (e as Error).message.slice(0, 200) });
      }
    }),
  );
  return out;
}

// Hook da madrugada: refaz as contas cujo retrato não é de hoje, até acabar o prazo (chamar de novo continua de onde parou).
export async function refreshAudienceForUser(
  db: Db,
  userId: string,
  token: string,
  opts: { force?: boolean; deadlineMs: number },
): Promise<{ done: number; pending: number }> {
  const all = (await audienceAccounts(db, userId)).map((a) => a.accountId);
  const snap = await readAudienceSnapshot(db, userId);
  const today = todayBrt();
  const todo = all.filter((id) => opts.force || !snap?.accounts[id] || snap.accounts[id].computedFor !== today || snap.accounts[id].error || !snap.accounts[id].windows);
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() > opts.deadlineMs - 15_000) break;
    const entries = await computeAudienceAccounts(db, userId, token, todo.slice(i, i + BATCH));
    await saveAudienceAccounts(db, userId, entries);
    done += entries.length;
  }
  return { done, pending: Math.max(0, todo.length - done) };
}
