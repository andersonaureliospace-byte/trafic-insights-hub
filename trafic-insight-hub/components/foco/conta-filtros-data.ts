import { fmtCacheTime } from "@/lib/client-cache";
import type { MetasSort } from "@/lib/meta/metas";
import type { AccountInsight } from "@/lib/meta/insights";

// Lê (sem buscar nada na Meta) os números que o Desempenho já deixou salvos neste navegador: cada período que ele já carregou + o gasto do mês.

export const PRIORITY_CPA_SORT = "priority_cpa" as const;
// Etapa 185: "Fora da meta (Speed)" — mesma régua do painel da agência (lib/meta/speed.ts).
export const SPEED_SORT = "speed" as const;
export type FocoSort = "manual" | MetasSort | typeof PRIORITY_CPA_SORT | typeof SPEED_SORT;

// Etapa 185: backups que só o "↻ Atualizar" do Foco grava — mês com CPA (sem orçamento) e gasto até ontem.
export const FOCO_MONTH_KEY = "foco-mes";
export const FOCO_UNTIL_YESTERDAY_KEY = "foco-ate-ontem";

const PREFIX = "tih_cache_v1:";

export interface DesempenhoCache {
  periods: Record<string, { at: number; data: Record<string, AccountInsight> }>; // por id do período (last_7d, today…)
  latest: string | null; // período salvo mais recente
  monthly: Record<string, AccountInsight>;
  // Etapa 185: mês até agora com CPA (regra da Speed) e gasto do dia 01 até ontem — só valem no mesmo dia em que foram salvos.
  monthFull: { at: number; data: Record<string, AccountInsight> } | null;
  untilYesterday: { at: number; data: Record<string, AccountInsight> } | null;
  at: number;
}

const spDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(t);
export const isToday = (at: number | undefined) => at != null && spDay(at) === spDay(Date.now());

export function readDesempenhoCache(): DesempenhoCache | null {
  try {
    if (typeof window === "undefined") return null;
    const periods: DesempenhoCache["periods"] = {};
    let latest: string | null = null;
    let monthly: { at: number; data: Record<string, AccountInsight> } | null = null;
    let monthFull: DesempenhoCache["monthFull"] = null;
    let untilYesterday: DesempenhoCache["untilYesterday"] = null;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const name = k.slice(PREFIX.length);
      const isPeriod = name.startsWith("acomp-insights:");
      if (!isPeriod && name !== "acomp-mensal" && name !== FOCO_MONTH_KEY && name !== FOCO_UNTIL_YESTERDAY_KEY) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const p = JSON.parse(raw) as { at?: unknown; data?: unknown };
      if (typeof p.at !== "number" || !p.data || typeof p.data !== "object") continue;
      const item = { at: p.at, data: p.data as Record<string, AccountInsight> };
      if (name === FOCO_MONTH_KEY) {
        monthFull = item;
      } else if (name === FOCO_UNTIL_YESTERDAY_KEY) {
        untilYesterday = item;
      } else if (isPeriod) {
        const id = name.slice("acomp-insights:".length);
        periods[id] = item;
        if (!latest || item.at > periods[latest].at) latest = id;
      } else {
        monthly = item;
      }
    }
    if (!latest && !monthly && !monthFull) return null;
    return {
      periods,
      latest,
      monthly: monthly?.data ?? {},
      monthFull,
      untilYesterday,
      at: Math.max(latest ? periods[latest].at : 0, monthly?.at ?? 0),
    };
  } catch {
    return null;
  }
}

export function cacheLabel(at: number): string {
  return fmtCacheTime(at);
}
