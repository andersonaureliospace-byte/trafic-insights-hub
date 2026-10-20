"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtCurrency, priorityRank } from "@/lib/format";
import { PRIORITY_CPA_SORT, type FocoSort, cacheLabel, readDesempenhoCache } from "@/components/foco/conta-filtros-data";
import { METAS_SORTS, compareMetas, computeMetas, metasCalendar, type CpaStatus } from "@/lib/meta/metas";
import { RITMO_BAND, ritmoColorClass, ritmoFromInsight } from "@/lib/meta/ritmo";
import { usePriorityOptions } from "@/lib/priority-context";

// Painel lateral do modo Foco: lista vertical de clientes (Nome | Status | CPA | Ritmo) com busca e os mesmos filtros do Desempenho
// (Status, CPA, Investimento, Otimizado, Atenção + Ordem). Filtra só a LISTA — nada é buscado na Meta. CPA, Ritmo e os filtros/ordens por número
// usam o que o Desempenho já deixou salvo neste navegador (sem isso aparecem "—" e esses filtros ficam desativados). Atenção = lista do Resumo das 7h.

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

const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const CPA_TEXT: Record<CpaStatus, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};
const selCls = "h-7 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-1.5 text-xs disabled:opacity-40 dark:border-zinc-700";
const lblCls = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400";
const COLS = "grid-cols-[minmax(0,1fr)_4.4rem_3.4rem_3.4rem]";

export function ContaLateral({ opts, value, onChoose }: { opts: FiltroOpt[]; value: string; onChoose: (id: string) => void }) {
  const { options: priorityOptions } = usePriorityOptions();
  const [q, setQ] = useState("");
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

  // Números de cada conta que aparecem na lista (CPA, Ritmo) — vêm só do backup do Desempenho.
  const info = useMemo(() => {
    const ins = cache?.insights ?? {};
    const mon = cache?.monthly ?? {};
    const m = new Map<string, { cpa: number | null; cpaStatus: CpaStatus | null; ritmo: number | null; ritmoCls: string }>();
    for (const o of opts) {
      const rit = ritmoFromInsight(o.monthlyInvestment, mon[o.id]);
      const daily = ins[o.id]?.daily_budget ?? 0;
      const metas = computeMetas(
        { invested: mon[o.id]?.spend ?? 0, monthlyTarget: o.monthlyInvestment, cpa: ins[o.id]?.cost_per_result ?? null, cpaTarget: o.cpaTarget, dailyBudget: daily, ritmo: rit },
        cal.elapsedDays,
        cal.daysInMonth,
      );
      m.set(o.id, {
        cpa: ins[o.id]?.cost_per_result ?? null,
        cpaStatus: metas.cpaStatus,
        ritmo: rit,
        ritmoCls: rit != null && ins[o.id] ? ritmoColorClass(rit, daily) : "",
      });
    }
    return m;
  }, [opts, cache, cal]);

  const list = useMemo(() => {
    const ins = cache?.insights ?? {};
    const needle = flat(q.trim());
    const metasOf = (o: FiltroOpt) =>
      computeMetas(
        {
          invested: cache?.monthly[o.id]?.spend ?? 0,
          monthlyTarget: o.monthlyInvestment,
          cpa: ins[o.id]?.cost_per_result ?? null,
          cpaTarget: o.cpaTarget,
          dailyBudget: ins[o.id]?.daily_budget ?? 0,
          ritmo: info.get(o.id)?.ritmo ?? null,
        },
        cal.elapsedDays,
        cal.daysInMonth,
      );
    const diffOf = (o: FiltroOpt) => {
      const actual = ins[o.id]?.cost_per_result;
      return actual != null && o.cpaTarget != null ? actual - o.cpaTarget : null;
    };
    return opts
      .filter((o) => !needle || flat(o.name).includes(needle))
      .filter((o) => priority === "all" || (o.priority ?? "") === priority)
      .filter((o) => {
        if (cpa !== "high") return true;
        const actual = ins[o.id]?.cost_per_result;
        return o.cpaTarget != null && actual != null && actual > o.cpaTarget;
      })
      .filter((o) => {
        if (invest === "all") return true;
        const r = info.get(o.id)?.ritmo;
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
        return compareMetas(metasOf(a), metasOf(b), sort) || a.name.localeCompare(b.name, "pt-BR");
      });
  }, [opts, q, priority, cpa, invest, optimized, attentionF, attention, sort, cache, cal, info]);

  const activeCount = [q.trim() !== "", priority !== "all", cpa !== "all", invest !== "all", optimized !== "all", attentionF !== "all"].filter(Boolean).length;
  const noData = !cache;
  const noDataHint = "Sem números salvos neste navegador — abra o Desempenho uma vez (aqui só usa o que ele já carregou, sem buscar nada novo).";
  const prio = (id: string | null) => priorityOptions.find((p) => p.id === id) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="shrink-0 space-y-2 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente…"
          className="h-8 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
        />
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <label>
            <span className={lblCls}>Status</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selCls}>
              <option value="all">Todos</option>
              {priorityOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={lblCls}>Otimizado</span>
            <select value={optimized} onChange={(e) => setOptimized(e.target.value as "all" | "optimized" | "pending")} className={selCls}>
              <option value="all">Todos</option>
              <option value="optimized">Otimizado</option>
              <option value="pending">Pendente</option>
            </select>
          </label>
          <label title={noData ? noDataHint : undefined}>
            <span className={lblCls}>CPA</span>
            <select value={cpa} onChange={(e) => setCpa(e.target.value as "all" | "high")} disabled={noData} className={selCls}>
              <option value="all">Todos</option>
              <option value="high">CPA alto</option>
            </select>
          </label>
          <label title={noData ? noDataHint : undefined}>
            <span className={lblCls}>Investimento</span>
            <select value={invest} onChange={(e) => setInvest(e.target.value as "all" | "low" | "high")} disabled={noData} className={selCls}>
              <option value="all">Todos</option>
              <option value="low">Baixo</option>
              <option value="high">Alto</option>
            </select>
          </label>
          <label>
            <span className={lblCls}>Atenção</span>
            <select value={attentionF} onChange={(e) => setAttentionF(e.target.value as "all" | "attention")} className={selCls}>
              <option value="all">Todos</option>
              <option value="attention">🚨 Atenção ({Object.keys(attention).length})</option>
            </select>
          </label>
          <label>
            <span className={lblCls}>Ordem</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as FocoSort)} className={selCls}>
              <option value="manual">Ordem salva</option>
              <option value={PRIORITY_CPA_SORT} disabled={noData}>
                Prioridade + dif. do CPA
              </option>
              {METAS_SORTS.map((s) => (
                <option key={s.id} value={s.id} disabled={noData}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          <span title={cache ? `Números do Desempenho salvos às ${cacheLabel(cache.at)}` : noDataHint}>
            {list.length} de {opts.length} clientes{cache ? ` · ${cacheLabel(cache.at)}` : ""}
          </span>
          {activeCount > 0 ? (
            <button
              onClick={() => {
                setQ("");
                setPriority("all");
                setCpa("all");
                setInvest("all");
                setOptimized("all");
                setAttentionF("all");
              }}
              className="underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      <div className={`grid ${COLS} shrink-0 gap-x-1.5 border-b border-zinc-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:border-zinc-800`}>
        <span>Nome</span>
        <span>Status</span>
        <span className="text-right">CPA</span>
        <span className="text-right">Ritmo</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {list.length === 0 ? <li className="px-3 py-6 text-center text-sm text-zinc-500">Nenhum cliente com esses filtros.</li> : null}
        {list.map((o) => {
          const i = info.get(o.id);
          const p = prio(o.priority);
          const att = attention[o.id.replace(/^act_/, "")];
          return (
            <li key={o.id}>
              <button
                onClick={() => onChoose(o.id)}
                title={att ? `Precisa de atenção: ${att.reasons.join(", ")}` : o.name}
                className={`grid ${COLS} w-full items-center gap-x-1.5 border-b border-zinc-100 px-2.5 py-1.5 text-left text-sm transition-colors dark:border-zinc-800/60 ${
                  o.id === value ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${o.optimized ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    title={o.optimized ? "Otimizada hoje" : "Pendente"}
                  />
                  <span className="truncate">
                    {att ? "🚨 " : ""}
                    {o.name}
                  </span>
                </span>
                <span>
                  {p ? (
                    <span className="inline-block max-w-full truncate rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium" style={{ backgroundColor: `${p.color}26`, color: p.color }}>
                      {p.label}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                  )}
                </span>
                <span className={`text-right text-xs tabular-nums ${i?.cpaStatus ? CPA_TEXT[i.cpaStatus] : "text-zinc-400"}`}>{i?.cpa != null ? fmtCurrency(i.cpa) : "—"}</span>
                <span className={`text-right text-xs tabular-nums ${i?.ritmo != null ? i.ritmoCls : "text-zinc-400"}`}>{i?.ritmo != null ? fmtCurrency(i.ritmo) : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
