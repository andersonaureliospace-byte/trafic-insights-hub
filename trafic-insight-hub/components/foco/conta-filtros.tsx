"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { priorityRank } from "@/lib/format";
import { PRIORITY_CPA_SORT, type FocoSort, cacheLabel, readDesempenhoCache } from "@/components/foco/conta-filtros-data";
import { METAS_SORTS, compareMetas, computeMetas, metasCalendar } from "@/lib/meta/metas";
import { RITMO_BAND, ritmoFromInsight } from "@/lib/meta/ritmo";
import { usePriorityOptions } from "@/lib/priority-context";

// Filtros do seletor de conta do modo Foco: os mesmos do Desempenho (Status, CPA, Investimento, Otimizado, Atenção + ordenação).
// Só mexem na LISTA de nomes. Nada é buscado na Meta: CPA / Investimento / ordenações por número usam o que o Desempenho já deixou
// salvo neste navegador (se ainda não existe, esses ficam desativados). Atenção vem da lista do Resumo das 7h (Supabase).

export interface FiltroOpt {
  id: string;
  name: string;
  priority: string | null;
  sortOrder: number | null;
  cpaTarget: number | null;
  monthlyInvestment: number | null;
  optimized: boolean;
}

type Att = Record<string, { points: number; reasons: string[] }>;

const selCls = "h-7 rounded-md border border-zinc-300 bg-transparent px-2 text-xs disabled:opacity-40 dark:border-zinc-700";
const lblCls = "text-xs font-medium uppercase tracking-wide text-zinc-400";

export function useContaFiltros(opts: FiltroOpt[]): { list: FiltroOpt[]; bar: ReactNode; activeCount: number } {
  const { options: priorityOptions } = usePriorityOptions();
  const [priority, setPriority] = useState("all");
  const [cpa, setCpa] = useState<"all" | "high">("all");
  const [invest, setInvest] = useState<"all" | "low" | "high">("all");
  const [optimized, setOptimized] = useState<"all" | "optimized" | "pending">("all");
  const [attentionF, setAttentionF] = useState<"all" | "attention">("all");
  const [sort, setSort] = useState<FocoSort>("manual");
  const [attention, setAttention] = useState<Att>({});
  const [cache, setCache] = useState<ReturnType<typeof readDesempenhoCache>>(null);
  const cal = useMemo(() => metasCalendar(), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o backup local do Desempenho uma vez ao abrir
    setCache(readDesempenhoCache());
    let cancelled = false;
    fetch("/api/alerts/attention")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: Att } | null) => {
        if (!cancelled && d?.accounts) setAttention(d.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const list = useMemo(() => {
    const ins = cache?.insights ?? {};
    const mon = cache?.monthly ?? {};
    const metas = (o: FiltroOpt) =>
      computeMetas(
        {
          invested: mon[o.id]?.spend ?? 0,
          monthlyTarget: o.monthlyInvestment,
          cpa: ins[o.id]?.cost_per_result ?? null,
          cpaTarget: o.cpaTarget,
          dailyBudget: ins[o.id]?.daily_budget ?? 0,
          ritmo: ritmoFromInsight(o.monthlyInvestment, mon[o.id]),
        },
        cal.elapsedDays,
        cal.daysInMonth,
      );
    const diffOf = (o: FiltroOpt) => {
      const actual = ins[o.id]?.cost_per_result;
      return actual != null && o.cpaTarget != null ? actual - o.cpaTarget : null;
    };

    return opts
      .filter((o) => priority === "all" || (o.priority ?? "") === priority)
      .filter((o) => {
        if (cpa !== "high") return true;
        const actual = ins[o.id]?.cost_per_result;
        return o.cpaTarget != null && actual != null && actual > o.cpaTarget;
      })
      .filter((o) => {
        if (invest === "all") return true;
        const r = ritmoFromInsight(o.monthlyInvestment, mon[o.id]);
        if (r == null) return false;
        const diff = r - (ins[o.id]?.daily_budget ?? 0);
        return invest === "low" ? diff > RITMO_BAND : diff < -RITMO_BAND;
      })
      .filter((o) => optimized === "all" || (optimized === "optimized" ? o.optimized : !o.optimized))
      .filter((o) => attentionF === "all" || !!attention[o.id.replace(/^act_/, "")])
      .sort((a, b) => {
        if (sort === "manual") {
          const k = (o: FiltroOpt) => o.sortOrder ?? 1_000_000_000 - (ins[o.id]?.spend ?? 0);
          return k(a) - k(b) || a.name.localeCompare(b.name, "pt-BR");
        }
        if (sort === PRIORITY_CPA_SORT) {
          const rk = priorityRank(a.priority) - priorityRank(b.priority);
          if (rk !== 0) return rk;
          const da = diffOf(a);
          const db = diffOf(b);
          if (da == null && db == null) return a.name.localeCompare(b.name, "pt-BR");
          if (da == null) return 1;
          if (db == null) return -1;
          return db - da;
        }
        return compareMetas(metas(a), metas(b), sort) || a.name.localeCompare(b.name, "pt-BR");
      });
  }, [opts, priority, cpa, invest, optimized, attentionF, attention, sort, cache, cal]);

  const activeCount = [priority !== "all", cpa !== "all", invest !== "all", optimized !== "all", attentionF !== "all"].filter(Boolean).length;
  const noData = !cache;
  const noDataHint = "Sem números salvos neste navegador — abra o Desempenho uma vez (aqui só usa o que ele já carregou, sem buscar nada novo).";

  const bar = (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1.5">
        <span className={lblCls}>Status</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selCls}>
          <option value="all">Todos</option>
          {priorityOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5" title={noData ? noDataHint : undefined}>
        <span className={lblCls}>CPA</span>
        <select value={cpa} onChange={(e) => setCpa(e.target.value as "all" | "high")} disabled={noData} className={selCls}>
          <option value="all">Todos</option>
          <option value="high">CPA alto</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5" title={noData ? noDataHint : undefined}>
        <span className={lblCls}>Investimento</span>
        <select value={invest} onChange={(e) => setInvest(e.target.value as "all" | "low" | "high")} disabled={noData} className={selCls}>
          <option value="all">Todos</option>
          <option value="low">Baixo</option>
          <option value="high">Alto</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={lblCls}>Otimizado</span>
        <select value={optimized} onChange={(e) => setOptimized(e.target.value as "all" | "optimized" | "pending")} className={selCls}>
          <option value="all">Todos</option>
          <option value="optimized">Otimizado</option>
          <option value="pending">Pendente</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={lblCls}>Atenção</span>
        <select value={attentionF} onChange={(e) => setAttentionF(e.target.value as "all" | "attention")} className={selCls}>
          <option value="all">Todos</option>
          <option value="attention">🚨 Precisam de atenção ({Object.keys(attention).length})</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={lblCls}>Ordem</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as FocoSort)} className={selCls}>
          <option value="manual">Ordem salva</option>
          <option value={PRIORITY_CPA_SORT} disabled={noData}>
            Prioridade + maior diferença do CPA
          </option>
          {METAS_SORTS.map((s) => (
            <option key={s.id} value={s.id} disabled={noData}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <span className="text-xs text-zinc-400">
        {list.length} de {opts.length} contas{cache ? ` · números do Desempenho de ${cacheLabel(cache.at)}` : ""}
      </span>
      {activeCount > 0 ? (
        <button
          onClick={() => {
            setPriority("all");
            setCpa("all");
            setInvest("all");
            setOptimized("all");
            setAttentionF("all");
          }}
          className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Limpar filtros
        </button>
      ) : null}
    </div>
  );

  return { list, bar, activeCount };
}
