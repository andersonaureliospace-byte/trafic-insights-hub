"use client";

import { useEffect, useMemo, useState } from "react";
import { writeTabCache } from "@/lib/client-cache";
import { DATE_PRESETS, priorityRank } from "@/lib/format";
import {
  FOCO_MONTH_KEY,
  FOCO_UNTIL_YESTERDAY_KEY,
  PRIORITY_CPA_SORT,
  SPEED_SORT,
  type FocoSort,
  cacheLabel,
  isToday,
  readDesempenhoCache,
} from "@/components/foco/conta-filtros-data";
import { METAS_SORTS, compareMetas, computeMetas, metasCalendar } from "@/lib/meta/metas";
import { monthCalendarSP, ritmoColorClass, ritmoFromInsight } from "@/lib/meta/ritmo";
import {
  SPEED_CPA_LABEL,
  SPEED_INVEST_LABEL,
  computeSpeed,
  speedBudgetTooltip,
  speedCpaStatus,
  speedSortKey,
  type SpeedCpa,
  type SpeedOverall,
  type SpeedRow,
} from "@/lib/meta/speed";
import type { AccountInsight } from "@/lib/meta/insights";
import { usePriorityOptions } from "@/lib/priority-context";

// Etapa 185: colunas viraram Nome | Prioridade | CPA | Hoje⇄Amanhã. "Status" passou a se chamar "Prioridade" (o mesmo nome do campo no
// Asana — é a classificação dos últimos 3 dias); o status da Speed (mensal) aparece como uma faixa colorida à esquerda de cada linha.
// Hoje⇄Amanhã (clique no título alterna) = Gastar hoje / Gastar amanhã de lib/meta/speed.ts; ao passar o mouse mostra a conta.
// Painel lateral do modo Foco: lista vertical de clientes (Nome | Status | CPA | Ritmo) com busca e os mesmos filtros do Desempenho
// (Status, CPA, Investimento, Otimizado, Atenção + Ordem). Filtra só a LISTA — nada é buscado na Meta. CPA, Ritmo e os filtros/ordens por número
// usam o que o Desempenho já deixou salvo neste navegador (sem isso aparecem "—" e esses filtros ficam desativados). Atenção = lista do Resumo das 7h.
// O botão "↻ Atualizar" é o único que consulta a Meta (todos os clientes, no período escolhido + gasto do mês) e grava no mesmo backup do Desempenho.

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
const CPA_TEXT: Record<SpeedCpa, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};
// Faixa à esquerda da linha = status da Speed no mês (investimento + CPA).
const SPEED_STRIPE: Record<SpeedOverall, string> = {
  ok: "border-l-emerald-500",
  acceptable: "border-l-orange-400",
  off: "border-l-red-500",
};
const selCls = "h-7 w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-1.5 text-xs disabled:opacity-40 dark:border-zinc-700";
const lblCls = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400";
// Colunas fixas: Nome ocupa o que sobra; Status centralizado; CPA e Ritmo alinhados à direita (cabeçalho e valores com o mesmo recuo).
const COLS = "grid-cols-[minmax(0,1fr)_4.2rem_3.6rem_4.6rem]";
const num = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: number) => `${v < 0 ? "−" : "+"}${num(Math.abs(v))}`;

export function ContaLateral({ opts, value, onChoose }: { opts: FiltroOpt[]; value: string; onChoose: (id: string) => void }) {
  const { options: priorityOptions } = usePriorityOptions();
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("all");
  const [cpa, setCpa] = useState<"all" | "high">("all");
  const [invest, setInvest] = useState<"all" | "low" | "high">("all");
  const [optimized, setOptimized] = useState<"all" | "optimized" | "pending">("all");
  const [attentionF, setAttentionF] = useState<"all" | "attention">("all");
  const [sort, setSort] = useState<FocoSort>("manual");
  const [budgetMode, setBudgetMode] = useState<"hoje" | "amanha">("amanha");
  const [period, setPeriod] = useState(""); // "" = o período salvo mais recente
  const [attention, setAttention] = useState<Att>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);
  const [cache, setCache] = useState<ReturnType<typeof readDesempenhoCache>>(null);
  const cal = useMemo(() => metasCalendar(), []);
  // Período dos números (CPA, Ritmo, filtros): só os que o Desempenho já carregou; os outros ficam desativados.
  const periodId = period && cache?.periods[period] ? period : (cache?.latest ?? "");
  const insightsAll = useMemo(() => cache?.periods[periodId]?.data ?? {}, [cache, periodId]);

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

  // Números de cada conta que aparecem na lista — vêm só do backup do Desempenho/Foco (nada é buscado aqui).
  // CPA = período escolhido (cor pela régua da Speed). Speed (faixa, Hoje⇄Amanhã, filtro Investimento, ordem Speed) = mês ao vivo.
  const info = useMemo(() => {
    const ins = insightsAll;
    const mon = cache?.monthly ?? {};
    const monFull = cache?.monthFull && isToday(cache.monthFull.at) ? cache.monthFull.data : null;
    const until = cache?.untilYesterday && isToday(cache.untilYesterday.at) ? cache.untilYesterday.data : null;
    const firstDay = monthCalendarSP().day === 1;
    const m = new Map<
      string,
      { cpa: number | null; cpaStatus: SpeedCpa | null; cpaDiff: number | null; ritmo: number | null; speed: SpeedRow; budget: number | null; budgetCls: string }
    >();
    for (const o of opts) {
      const rit = ritmoFromInsight(o.monthlyInvestment, mon[o.id]);
      const daily = ins[o.id]?.daily_budget ?? 0;
      const monthIns = monFull?.[o.id] && !monFull[o.id].insights_failed ? monFull[o.id] : null;
      const spentSoFar = monthIns?.spend ?? (mon[o.id] && !mon[o.id].insights_failed ? mon[o.id].spend : null);
      const untilIns = until?.[o.id];
      const speed = computeSpeed({
        monthlyTarget: o.monthlyInvestment,
        spentSoFar,
        spentUntilYesterday: firstDay ? 0 : untilIns && !untilIns.insights_failed ? untilIns.spend : null,
        cpa: monthIns?.cost_per_result ?? null,
        cpaTarget: o.cpaTarget,
        dailyBudget: daily,
      });
      m.set(o.id, {
        cpa: ins[o.id]?.cost_per_result ?? null,
        cpaStatus: speedCpaStatus(ins[o.id]?.cost_per_result ?? null, o.cpaTarget),
        cpaDiff: ins[o.id]?.cost_per_result != null && o.cpaTarget != null ? ins[o.id].cost_per_result! - o.cpaTarget : null,
        budget: ins[o.id] ? daily : null,
        ritmo: rit,
        speed,
        budgetCls: speed.gastarAmanha != null && ins[o.id] ? ritmoColorClass(speed.gastarAmanha, daily) : "",
      });
    }
    return m;
  }, [opts, cache, insightsAll]);

  // Busca na Meta os números de TODOS os clientes da lista (mesmas chamadas do Desempenho) e grava no backup local. Só roda quando clica.
  async function refresh() {
    if (refreshing || opts.length === 0) return;
    setRefreshing(true);
    setRefreshErr(null);
    const ids = opts.map((o) => o.id);
    const preset = periodId || "last_7d";
    const call = async (body: Record<string, unknown>) => {
      const res = await fetch("/api/meta/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ accountIds: ids, ...body }),
      });
      const d = (await res.json()) as { insights?: Record<string, AccountInsight>; error?: string };
      if (!d.insights) throw new Error(d.error ?? "A Meta não respondeu.");
      return d.insights;
    };
    try {
      const period = await call({ datePreset: preset });
      writeTabCache(`acomp-insights:${preset}`, period);
      setCache(readDesempenhoCache());
      setPeriod(preset);
      // Etapa 185: mês até agora COM CPA (sem as chamadas de orçamento — 1 por conta) + gasto até ontem (backup diário).
      const month = await call({ datePreset: "this_month", skipBudget: true });
      writeTabCache("acomp-mensal", month);
      writeTabCache(FOCO_MONTH_KEY, month);
      setCache(readDesempenhoCache());
      if (monthCalendarSP().day > 1) {
        const until = await call({ datePreset: "this_month_until_yesterday", spendOnly: true });
        writeTabCache(FOCO_UNTIL_YESTERDAY_KEY, until);
        setCache(readDesempenhoCache());
      }
    } catch (e) {
      const m = (e as Error).message;
      setRefreshErr(/failed to fetch|networkerror|load failed/i.test(m) ? "Sem conexão com o servidor agora. Tente de novo." : m);
    } finally {
      setRefreshing(false);
    }
  }

  const list = useMemo(() => {
    const ins = insightsAll;
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
        // Etapa 185: Investimento Baixo/Alto = status da Speed (gasto até ontem × ideal até hoje, folga de 2%).
        if (invest === "all") return true;
        const st = info.get(o.id)?.speed.investStatus;
        return invest === "low" ? st === "below" : st === "above";
      })
      .filter((o) => optimized === "all" || (optimized === "optimized" ? o.optimized : !o.optimized))
      .filter((o) => attentionF === "all" || !!attention[o.id.replace(/^act_/, "")])
      .sort((a, b) => {
        if (sort === "manual") {
          const k = (o: FiltroOpt) => o.sortOrder ?? 1_000_000_000 - (ins[o.id]?.spend ?? 0);
          return k(a) - k(b) || a.name.localeCompare(b.name, "pt-BR");
        }
        if (sort === SPEED_SORT) {
          const ka = info.get(a.id) ? speedSortKey(info.get(a.id)!.speed) : Number.NEGATIVE_INFINITY;
          const kb = info.get(b.id) ? speedSortKey(info.get(b.id)!.speed) : Number.NEGATIVE_INFINITY;
          if (ka !== kb) return kb > ka ? 1 : -1;
          return a.name.localeCompare(b.name, "pt-BR");
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
  }, [opts, q, priority, cpa, invest, optimized, attentionF, attention, sort, cache, cal, info, insightsAll]);

  const activeCount = [q.trim() !== "", priority !== "all", cpa !== "all", invest !== "all", optimized !== "all", attentionF !== "all"].filter(Boolean).length;
  const noData = !cache;
  const noDataHint = "Sem números salvos neste navegador — abra o Desempenho uma vez (aqui só usa o que ele já carregou, sem buscar nada novo).";
  const prio = (id: string | null) => priorityOptions.find((p) => p.id === id) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="shrink-0 space-y-2 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente…"
            className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            onClick={() => void refresh()}
            disabled={refreshing || opts.length === 0}
            title="Busca na Meta os números de todos os clientes da lista (CPA do período, mês ao vivo e gasto até ontem). Pode levar alguns segundos."
            className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {refreshing ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
        {refreshErr ? <p className="text-xs text-red-600">{refreshErr}</p> : null}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <label>
            <span className={lblCls}>Prioridade</span>
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
          <label title={noData ? noDataHint : "Status de investimento da Speed: gasto até ontem × ideal até hoje, com 2% de folga."}>
            <span className={lblCls}>Investimento</span>
            <select value={invest} onChange={(e) => setInvest(e.target.value as "all" | "low" | "high")} disabled={noData} className={selCls}>
              <option value="all">Todos</option>
              <option value="low">Abaixo (Speed)</option>
              <option value="high">Acima (Speed)</option>
            </select>
          </label>
          <label>
            <span className={lblCls}>Atenção</span>
            <select value={attentionF} onChange={(e) => setAttentionF(e.target.value as "all" | "attention")} className={selCls}>
              <option value="all">Todos</option>
              <option value="attention">🚨 Atenção ({Object.keys(attention).length})</option>
            </select>
          </label>
          <label title={noData ? noDataHint : "Período dos números da lista (CPA, Ritmo e filtros). Só aparecem os que o Desempenho já carregou neste navegador."}>
            <span className={lblCls}>Período</span>
            <select value={periodId} onChange={(e) => setPeriod(e.target.value)} disabled={noData} className={selCls}>
              {noData ? <option value="">—</option> : null}
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id} disabled={!cache?.periods[p.id]}>
                  {p.label}
                  {cache?.periods[p.id] ? "" : " (sem dados)"}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            <span className={lblCls}>Ordem</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as FocoSort)} className={selCls}>
              <option value="manual">Ordem salva</option>
              <option value={SPEED_SORT} disabled={noData}>
                Fora da meta (Speed)
              </option>
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
          <span title={cache ? `Números do Desempenho salvos às ${cacheLabel(cache.periods[periodId]?.at ?? cache.at)}` : noDataHint}>
            {list.length} de {opts.length} clientes{cache ? ` · ${cacheLabel(cache.periods[periodId]?.at ?? cache.at)}` : ""}
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
        <span>Cliente</span>
        <span className="text-center">Prioridade</span>
        <span className="text-right">CPA</span>
        <button
          type="button"
          onClick={() => setBudgetMode((m) => (m === "hoje" ? "amanha" : "hoje"))}
          title={budgetMode === "hoje" ? "Ritmo: em cima = investimento real de hoje (até agora); embaixo = quanto falta pra chegar no Gastar hoje. Clique pra ver Gastar amanhã." : "Gastar amanhã: orçamento pra configurar. Clique pra ver Gastar hoje."}
          className="text-right font-medium uppercase tracking-wide text-sky-600 underline decoration-dotted underline-offset-2 hover:text-sky-800 dark:text-sky-400"
        >
          {budgetMode === "hoje" ? "Ritmo ⇄" : "Amanhã ⇄"}
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {list.length === 0 ? <li className="px-3 py-6 text-center text-sm text-zinc-500">Nenhum cliente com esses filtros.</li> : null}
        {list.map((o) => {
          const i = info.get(o.id);
          const p = prio(o.priority);
          const att = attention[o.id.replace(/^act_/, "")];
          const sp = i?.speed;
          const speedTitle = sp?.overall
            ? `Speed (mês): investimento ${sp.investStatus ? SPEED_INVEST_LABEL[sp.investStatus] : "—"} · CPA ${sp.cpaStatus ? SPEED_CPA_LABEL[sp.cpaStatus] : "—"}`
            : "Speed: sem dado do mês — clique em ↻ Atualizar";
          const budgetVal = budgetMode === "hoje" ? sp?.gastarHoje : sp?.gastarAmanha;
          return (
            <li key={o.id}>
              <button
                onClick={() => onChoose(o.id)}
                title={`${att ? `Precisa de atenção: ${att.reasons.join(", ")}` : o.name}\n${speedTitle}`}
                className={`grid ${COLS} w-full items-center gap-x-1.5 border-b border-l-4 border-zinc-100 px-2.5 py-1.5 text-left text-sm transition-colors dark:border-zinc-800/60 ${
                  sp?.overall ? SPEED_STRIPE[sp.overall] : "border-l-transparent"
                } ${
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
                <span className="text-center">
                  {p ? (
                    <span className="inline-block max-w-full truncate rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium" style={{ backgroundColor: `${p.color}26`, color: p.color }}>
                      {p.label}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                  )}
                </span>
                <span className={`text-right tabular-nums ${i?.cpaStatus ? CPA_TEXT[i.cpaStatus] : "text-zinc-400"}`} title="CPA do período · embaixo: diferença pro CPA ideal">
                  <span className="block text-xs leading-tight">{i?.cpa != null ? num(i.cpa) : "—"}</span>
                  {i?.cpa != null && i.cpaDiff != null ? <span className="block text-[10px] leading-tight opacity-70">{signed(i.cpaDiff)}</span> : null}
                </span>
                <span
                  title={sp ? speedBudgetTooltip(sp, o.monthlyInvestment) : undefined}
                  className={`text-right text-xs tabular-nums ${(budgetMode === "hoje" ? sp?.spentToday == null : budgetVal == null) ? "text-zinc-400" : budgetMode === "amanha" ? i?.budgetCls : ""}`}
                >
                  {budgetMode === "hoje" ? (
                    <>
                      {/* Ritmo (igual ao Orçamento por dia do Acompanhamento de metas): investimento real de hoje + quanto falta pro Gastar hoje. */}
                      <span className="block text-xs leading-tight">{sp?.spentToday != null ? num(sp.spentToday) : "—"}</span>
                      {sp?.gastarHoje != null ? (
                        <span className={`block text-[10px] leading-tight ${sp.gastarHoje > 0.004 ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {sp.gastarHoje > 0.004 ? `falta ${num(sp.gastarHoje)}` : "✓ batido"}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="block text-xs leading-tight">{budgetVal != null ? num(budgetVal) : "—"}</span>
                  )}
                  {/* Embaixo (modo Amanhã): orçamento atual − recomendado (+ = orçamento acima; − = falta subir). */}
                  {budgetMode === "amanha" && budgetVal != null && i?.budget != null ? (
                    <span className="block text-[10px] leading-tight opacity-70">{signed(i.budget - budgetVal)}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
