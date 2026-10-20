import { fmtCacheTime } from "@/lib/client-cache";
import type { MetasSort } from "@/lib/meta/metas";
import type { AccountInsight } from "@/lib/meta/insights";

// Lê (sem buscar nada na Meta) os números que o Desempenho já deixou salvos neste navegador: cada período que ele já carregou + o gasto do mês.

export const PRIORITY_CPA_SORT = "priority_cpa" as const;
export type FocoSort = "manual" | MetasSort | typeof PRIORITY_CPA_SORT;

const PREFIX = "tih_cache_v1:";

export interface DesempenhoCache {
  periods: Record<string, { at: number; data: Record<string, AccountInsight> }>; // por id do período (last_7d, today…)
  latest: string | null; // período salvo mais recente
  monthly: Record<string, AccountInsight>;
  at: number;
}

export function readDesempenhoCache(): DesempenhoCache | null {
  try {
    if (typeof window === "undefined") return null;
    const periods: DesempenhoCache["periods"] = {};
    let latest: string | null = null;
    let monthly: { at: number; data: Record<string, AccountInsight> } | null = null;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const name = k.slice(PREFIX.length);
      const isPeriod = name.startsWith("acomp-insights:");
      if (!isPeriod && name !== "acomp-mensal") continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const p = JSON.parse(raw) as { at?: unknown; data?: unknown };
      if (typeof p.at !== "number" || !p.data || typeof p.data !== "object") continue;
      const item = { at: p.at, data: p.data as Record<string, AccountInsight> };
      if (isPeriod) {
        const id = name.slice("acomp-insights:".length);
        periods[id] = item;
        if (!latest || item.at > periods[latest].at) latest = id;
      } else {
        monthly = item;
      }
    }
    if (!latest && !monthly) return null;
    return { periods, latest, monthly: monthly?.data ?? {}, at: Math.max(latest ? periods[latest].at : 0, monthly?.at ?? 0) };
  } catch {
    return null;
  }
}

export function cacheLabel(at: number): string {
  return fmtCacheTime(at);
}
