"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { OptimizedCell } from "@/components/painel/optimized-cell";
import { ritmo, ritmoColorClass } from "@/lib/meta/ritmo";
import {
  METAS_SORTS,
  computeMetas,
  metasCalendar,
  metasSortKey,
  type CpaStatus,
  type InvestStatus,
  type MetasRow,
  type MetasSort,
} from "@/lib/meta/metas";

// Acompanhamento de metas (Etapa 82) — modelado no dashboard da Speed:
// investimento e CPA do dia 01 até ontem (preset this_month_until_yesterday,
// dias já fechados) comparados com o ideal até HOJE (dia do mês, contando
// hoje — igual à Speed). Meta de investimento = Investimento mensal
// cadastrado; meta de CPA = CPA ideal cadastrado (Clientes/Acompanhamento).

interface Row {
  accountId: string;
  dailyBudget: number;
  ritmo: number | null;
  accountName: string;
  clientName: string;
  metas: MetasRow;
}

const INVEST_BAR: Record<InvestStatus, string> = {
  below: "bg-orange-500",
  ok: "bg-emerald-500",
  above: "bg-red-500",
};

const INVEST_TEXT: Record<InvestStatus, string> = {
  below: "text-orange-600 dark:text-orange-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  above: "text-red-600 dark:text-red-400",
};

const CPA_TEXT: Record<CpaStatus, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};

function InvestCell({ m, elapsedDays, daysInMonth }: { m: MetasRow; elapsedDays: number; daysInMonth: number }) {
  if (m.monthlyTarget == null || m.pctOfTarget == null) {
    return <span className="text-xs text-zinc-400">Sem Investimento mensal</span>;
  }
  const status = m.investStatus;
  const fill = Math.min(m.pctOfTarget, 1) * 100;
  const marker = (elapsedDays / daysInMonth) * 100;
  const tooltip =
    `Investimento atual: ${fmtCurrency(m.invested)}\n` +
    `Meta: ${fmtCurrency(m.monthlyTarget)}\n` +
    `Ideal até hoje: ${fmtCurrency(m.idealUntilToday)}`;
  return (
    <div className="w-44" title={tooltip}>
      <div className="mb-0.5 text-xs font-medium text-zinc-500">{Math.round(m.pctOfTarget * 100)}%</div>
      <div className="relative h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full ${status ? INVEST_BAR[status] : "bg-zinc-400"}`}
          style={{ width: `${fill}%` }}
        />
        {m.idealUntilToday != null ? (
          <div
            className="absolute -top-0.5 h-2.5 w-0.5 bg-zinc-900 dark:bg-zinc-100"
            style={{ left: `${Math.min(marker, 100)}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function MetasTab({
  accounts,
  clientNames,
  cpaTargets,
  monthlyTargets,
  optimized,
  onToggleOptimized,
  optimizedFilter,
  onOptimizedFilterChange,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  cpaTargets: Record<string, number | null>;
  monthlyTargets: Record<string, number | null>;
  // Etapa 83: coluna Otimizado própria desta aba (separada da de
  // Acompanhamento) — mesmo comportamento: marca/desmarca, filtro
  // Otimizado/Pendente e reset à meia-noite (horário de Brasília).
  optimized: Record<string, boolean>;
  onToggleOptimized: (accountId: string, next: boolean) => Promise<void> | void;
  optimizedFilter: "all" | "optimized" | "pending";
  onOptimizedFilterChange: (v: "all" | "optimized" | "pending") => void;
}) {
  const [insights, setInsights] = useState<
    Record<string, { spend: number; cost_per_result: number | null; daily_budget: number }>
  >({});
  // Ritmo precisa do gasto do MÊS CORRENTE inteiro (contando hoje), igual a
  // Acompanhamento — por isso uma busca à parte, além do "até ontem" acima.
  const [monthlyInsights, setMonthlyInsights] = useState<Record<string, { spend: number }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<MetasSort>("critical");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (accounts.length === 0) {
      setInsights({});
      setMonthlyInsights({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const accountIds = accounts.map((a) => a.account_id);
      const post = (datePreset: string) =>
        fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds, datePreset }),
        }).then((r) => r.json());
      const [untilYesterday, thisMonth] = await Promise.all([post("this_month_until_yesterday"), post("this_month")]);
      if (untilYesterday.error) throw new Error(untilYesterday.error);
      if (thisMonth.error) throw new Error(thisMonth.error);
      setInsights(untilYesterday.insights ?? {});
      setMonthlyInsights(thisMonth.insights ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accounts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao entrar na aba ou quando a seleção de contas muda
    void load();
  }, [load]);

  // Calendário só é calculado no cliente, no momento do render da aba — dias
  // decorridos do mês (contando hoje) e dias reais do mês, mesma base do Ritmo.
  const { elapsedDays, daysInMonth, untilLabel } = useMemo(() => metasCalendar(), []);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    const built = accounts
      .map<Row>((acc) => {
        const ins = insights[acc.account_id];
        return {
          accountId: acc.account_id,
          dailyBudget: ins?.daily_budget ?? 0,
          ritmo: ritmo(monthlyTargets[acc.account_id] ?? null, monthlyInsights[acc.account_id]?.spend),
          accountName: acc.name,
          clientName: clientNames[acc.account_id] ?? acc.name,
          metas: computeMetas(
            {
              invested: ins?.spend ?? 0,
              monthlyTarget: monthlyTargets[acc.account_id] ?? null,
              cpa: ins?.cost_per_result ?? null,
              cpaTarget: cpaTargets[acc.account_id] ?? null,
            },
            elapsedDays,
            daysInMonth,
          ),
        };
      })
      .filter((r) => !q || r.clientName.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q))
      .filter((r) => optimizedFilter === "all" || (optimizedFilter === "optimized") === !!optimized[r.accountId]);
    return built.sort((a, b) => metasSortKey(b.metas, sort) - metasSortKey(a.metas, sort));
  }, [accounts, insights, monthlyInsights, clientNames, cpaTargets, monthlyTargets, optimized, optimizedFilter, sort, search, elapsedDays, daysInMonth]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Acompanhamento de metas {loading ? "· atualizando…" : ""}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou conta…"
            className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Otimizado</span>
            <select
              value={optimizedFilter}
              onChange={(e) => onOptimizedFilterChange(e.target.value as "all" | "optimized" | "pending")}
              className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            >
              <option value="all">Todos</option>
              <option value="optimized">Otimizado</option>
              <option value="pending">Pendente</option>
            </select>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as MetasSort)}
            className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
          >
            {METAS_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

      <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {untilLabel
          ? `Investimento e CPA atualizados até ontem (${untilLabel}) — dia 01 a ${untilLabel}. `
          : "Hoje é dia 01 — o investimento e o CPA só passam a ter dado fechado a partir de amanhã. "}
        Ideal até hoje = Investimento mensal ÷ {daysInMonth} dias do mês × {elapsedDays}{" "}
        {elapsedDays === 1 ? "dia" : "dias"} (dia de hoje, contando hoje), igual ao dashboard de referência.
      </p>

      {error ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <th
                className="px-4 py-2 font-medium"
                title="Marcação manual do dia desta aba — reseta sozinha à meia-noite (horário de Brasília), separada da de Acompanhamento"
              >
                Otimizado
              </th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 text-right font-medium" title="Investimento mensal cadastrado (meta do mês)">
                Invest. mensal
              </th>
              <th className="px-4 py-2 text-right font-medium">Investimento até ontem</th>
              <th className="px-4 py-2 text-right font-medium">Ideal até hoje</th>
              <th className="px-4 py-2 font-medium" title="Investimento até ontem ÷ Investimento mensal cadastrado; o tracinho marca o ideal até hoje">
                % de investimento
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Orçamento diário atual dos conjuntos/campanhas ativos. Abaixo: diferença entre o orçamento diário já configurado e o Ritmo (Invest. diário − Ritmo)"
              >
                Invest. diário
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="(Investimento mensal − Valor usado nesse mês) ÷ dias restantes do mês (dias reais do mês — 28 a 31 —, incluindo hoje como 1 dos dias restantes)"
              >
                Ritmo
              </th>
              <th className="px-4 py-2 text-right font-medium" title="Abaixo: diferença pro CPA ideal">
                CPA atual
              </th>
              <th className="px-4 py-2 text-right font-medium">CPA ideal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = r.metas;
              const investColor = m.investStatus ? INVEST_TEXT[m.investStatus] : "";
              const cpaColor = m.cpaStatus ? CPA_TEXT[m.cpaStatus] : "";
              return (
                <tr key={r.accountId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2">
                    <OptimizedCell
                      optimized={!!optimized[r.accountId]}
                      onToggle={(next) => onToggleOptimized(r.accountId, next)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">{r.clientName}</div>
                    <a
                      href={adsManagerUrl(r.accountId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir no Gerenciador de Anúncios"
                      className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {r.accountName}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.monthlyTarget != null ? fmtCurrency(m.monthlyTarget) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <div className={`text-base font-semibold ${investColor}`}>{fmtCurrency(m.invested)}</div>
                    {m.investDiff != null ? (
                      <div className={`text-xs opacity-70 ${investColor}`}>{fmtCurrencySigned(m.investDiff)}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(m.idealUntilToday)}</td>
                  <td className="px-4 py-2">
                    <InvestCell m={m} elapsedDays={elapsedDays} daysInMonth={daysInMonth} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {(() => {
                      const diff = r.ritmo != null ? r.dailyBudget - r.ritmo : null;
                      const color = ritmoColorClass(r.ritmo, r.dailyBudget);
                      return (
                        <>
                          <div className={`text-base font-semibold ${color}`}>{fmtCurrency(r.dailyBudget)}</div>
                          {diff != null ? (
                            <div className={`text-xs opacity-70 ${color}`}>{fmtCurrencySigned(diff)}</div>
                          ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.ritmo)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <div className={`text-base font-semibold ${cpaColor}`}>{fmtCurrency(m.cpa)}</div>
                    {m.cpaDiff != null ? (
                      <div className={`text-xs opacity-70 ${cpaColor}`}>{fmtCurrencySigned(m.cpaDiff)}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.cpaTarget != null ? fmtCurrency(m.cpaTarget) : <span className="text-zinc-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-zinc-500">
                  Nenhuma conta encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
