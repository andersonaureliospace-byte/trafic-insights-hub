import { fmtCacheTime } from "@/lib/client-cache";
import type { MetasSort } from "@/lib/meta/metas";
import type { AccountInsight } from "@/lib/meta/insights";

// Lê (sem buscar nada na Meta) os números que o Desempenho já deixou salvos neste navegador: o período mais recente + o gasto do mês.

export const PRIORITY_CPA_SORT = "priority_cpa" as const;
export type FocoSort = "manual" | MetasSort | typeof PRIORITY_CPA_SORT;

const PREFIX = "tih_cache_v1:";

export interface DesempenhoCache {
  insights: Record<string, AccountInsight>;
  monthly: Record<string, AccountInsight>;
  at: number;
}

export function readDesempenhoCache(): DesempenhoCache | null {
  try {
    if (typeof window === "undefined") return null;
    let best: { at: number; data: Record<string, AccountInsight> } | null = null;
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
        if (!best || item.at > best.at) best = item;
      } else {
        monthly = item;
      }
    }
    if (!best && !monthly) return null;
    return { insights: best?.data ?? {}, monthly: monthly?.data ?? {}, at: Math.max(best?.at ?? 0, monthly?.at ?? 0) };
  } catch {
    return null;
  }
}

export function cacheLabel(at: number): string {
  return fmtCacheTime(at);
}
