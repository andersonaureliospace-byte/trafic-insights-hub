import type { SupabaseClient } from "@supabase/supabase-js";
import { todayBrt } from "@/lib/meta/daily-range";

// Etapa 350 (nova era — vários acessos): números AO VIVO da Meta guardados no Supabase, POR CONTA, e compartilhados
// por todo mundo que olha a mesma carteira (estrategista, gestores, celular, outro navegador).
//   - quem abre a tela/clica Atualizar lê daqui; a Meta só é chamada pra conta cujo número guardado está velho;
//   - atualização automática: aceita número de até 15 min; botão Atualizar: até 3 min (evita clique duplo gastar 2x);
//   - cada um atualiza só as contas que está vendo (gestor → só as dele);
//   - vale só pro dia: virou o dia, o guardado de ontem não serve mais;
//   - a Meta falhou numa conta → usa o último número guardado de hoje (se houver), em vez de deixar sem.
// Reaproveita a tabela meta_insights_cache (chave "live:<tipo>:<conta>") — nada pra rodar no banco.

export const LIVE_MAX_AGE_AUTO_MS = 15 * 60_000;
export const LIVE_MAX_AGE_MANUAL_MS = 3 * 60_000;

export const liveMaxAge = (force: unknown) => (force === true ? LIVE_MAX_AGE_MANUAL_MS : LIVE_MAX_AGE_AUTO_MS);

type Payload<T> = { at: number; day: string; data: T };

const keyOf = (kind: string, id: string) => `live:${kind}:${id.replace(/^act_/, "")}`;

// Buscas em andamento neste servidor: se duas pessoas pedirem a mesma conta ao mesmo tempo, a segunda espera a primeira.
const inflight = new Map<string, Promise<unknown>>();

export interface LiveResult<T> {
  data: Map<string, T>; // id (sem act_) → valor
  at: Map<string, number>; // id → quando esse valor saiu da Meta (ms)
  failed: string[]; // sem valor nenhum (Meta falhou e não tinha guardado de hoje)
  fetched: number; // quantas contas foram de fato pedidas à Meta nesta chamada
}

export async function withLiveCache<T>(
  db: SupabaseClient,
  ownerId: string,
  kind: string,
  ids: string[],
  maxAgeMs: number,
  fetcher: (missing: string[]) => Promise<{ data: Map<string, T>; failed: string[] }>,
): Promise<LiveResult<T>> {
  const norm = (id: string) => id.replace(/^act_/, "");
  const list = [...new Set(ids.map(norm).filter(Boolean))];
  const day = todayBrt();
  const now = Date.now();
  const data = new Map<string, T>();
  const at = new Map<string, number>();
  const stale = new Map<string, Payload<T>>();
  if (list.length === 0) return { data, at, failed: [], fetched: 0 };

  // 1) o que já está guardado
  const { data: rows } = await db
    .from("meta_insights_cache")
    .select("cache_key, payload")
    .eq("user_id", ownerId)
    .in("cache_key", list.map((id) => keyOf(kind, id)));
  const byKey = new Map((rows ?? []).map((r) => [r.cache_key as string, r.payload as Payload<T>]));
  const missing: string[] = [];
  for (const id of list) {
    const p = byKey.get(keyOf(kind, id));
    if (p && p.day === day && typeof p.at === "number") {
      if (now - p.at <= maxAgeMs) {
        data.set(id, p.data);
        at.set(id, p.at);
        continue;
      }
      stale.set(id, p);
    }
    missing.push(id);
  }

  // 2) quem já está sendo buscado por outra pessoa neste instante: espera em vez de pedir de novo
  const waiting: Array<Promise<void>> = [];
  const toFetch: string[] = [];
  for (const id of missing) {
    const k = `${ownerId}|${kind}|${id}`;
    const p = inflight.get(k) as Promise<{ v: T; at: number } | null> | undefined;
    if (p) {
      waiting.push(
        p.then((r) => {
          if (r) {
            data.set(id, r.v);
            at.set(id, r.at);
          }
        }),
      );
    } else toFetch.push(id);
  }

  // 3) busca na Meta só o que falta
  let failedFetch: string[] = [];
  if (toFetch.length > 0) {
    const job = fetcher(toFetch);
    const fetchedAt = Date.now();
    for (const id of toFetch) {
      const k = `${ownerId}|${kind}|${id}`;
      const one = job
        .then((r) => (r.data.has(id) ? { v: r.data.get(id) as T, at: fetchedAt } : null))
        .catch(() => null)
        .finally(() => inflight.delete(k));
      inflight.set(k, one);
    }
    try {
      const r = await job;
      failedFetch = toFetch.filter((id) => !r.data.has(id));
      const upserts: Array<{ user_id: string; cache_key: string; payload: Payload<T>; expires_at: string }> = [];
      for (const [rawId, v] of r.data) {
        const id = norm(rawId);
        data.set(id, v);
        at.set(id, fetchedAt);
        upserts.push({
          user_id: ownerId,
          cache_key: keyOf(kind, id),
          payload: { at: fetchedAt, day, data: v },
          expires_at: new Date(fetchedAt + LIVE_MAX_AGE_AUTO_MS).toISOString(),
        });
      }
      if (upserts.length > 0) {
        const { error } = await db.from("meta_insights_cache").upsert(upserts, { onConflict: "user_id,cache_key" });
        if (error) console.error("live-cache upsert", kind, error.message);
      }
    } catch (e) {
      console.error("live-cache fetch", kind, (e as Error).message);
      failedFetch = toFetch;
    }
  }
  await Promise.all(waiting);

  // 4) Meta falhou → último número guardado de hoje (mais velho, mas melhor que nada)
  const failed: string[] = [];
  for (const id of list) {
    if (data.has(id)) continue;
    const s = stale.get(id);
    if (s) {
      data.set(id, s.data);
      at.set(id, s.at);
    } else failed.push(id);
  }
  return { data, at, failed, fetched: toFetch.length - failedFetch.length };
}

// Pra resposta em JSON: { [id]: valor } e { [id]: ms }
export const toObj = <T,>(m: Map<string, T>): Record<string, T> => Object.fromEntries(m);
