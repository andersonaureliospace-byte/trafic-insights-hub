"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { ritmoFromInsight, ritmoTooltip, ritmoColorClass } from "@/lib/meta/ritmo";
import {
  METAS_SORTS,
  computeMetas,
  metasCalendar,
  compareMetas,
  type CpaStatus,
  type InvestStatus,
  type MetasRow,
  type MetasSort,
} from "@/lib/meta/metas";

// Acompanhamento de metas (Etapa 82) — modelado no dashboard da Speed:
// investimento e CPA do dia 01 até AGORA (preset this_month, contando o gasto
// de hoje — Etapa 92) comparados com o ideal até HOJE (dia do mês, contando
// hoje). Meta de investimento = Investimento mensal
// cadastrado; meta de CPA = CPA ideal cadastrado (Clientes/Acompanhamento).

interface MetasInsight {
  spend: number;
  cost_per_result: number | null;
  daily_budget: number;
  insights_failed?: boolean;
  insights_error?: string;
}

// Etapa 90: trocar de aba desmonta este componente — sem cache, voltar pra cá refazia
// a busca completa na Meta toda vez. Guarda a última busca completa (5 min).
const METAS_CACHE_MS = 5 * 60 * 1000;
let metasCache: {
  key: string;
  at: number;
  insights: Record<string, MetasInsight>;
} | null = null;

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
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  cpaTargets: Record<string, number | null>;
  monthlyTargets: Record<string, number | null>;
}) {
  const [insights, setInsights] = useState<
    Record<string, MetasInsight>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<MetasSort>("critical");
  const [search, setSearch] = useState("");

  // Espelho do estado (pra mesclar a busca só das fixadas sem depender do closure).
  const firstFailError = Object.values(insights).find((i) => i.insights_error)?.insights_error;
  const failedCount =
    Object.keys(insights).length === 0
      ? 0
      : accounts.filter((a) => !insights[a.account_id] || insights[a.account_id]?.insights_failed).length;

  const load = useCallback(async () => {
    if (accounts.length === 0) {
      setInsights({});
      return;
    }
    const accountsKey = accounts.map((a) => a.account_id).join(",");
    const targets = accounts;
    setLoading(true);
    setError(null);
    try {
      // Etapa 92: uma busca só — mês até agora (com hoje), com CPA e orçamento diário.
      const res = await fetch("/api/meta/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: targets.map((a) => a.account_id),
          datePreset: "this_month",
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      const fresh = (d.insights ?? {}) as Record<string, MetasInsight>;
      setInsights(fresh);
      metasCache = { key: accountsKey, at: Date.now(), insights: fresh };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accounts]);

  useEffect(() => {
    const key = accounts.map((a) => a.account_id).join(",");
    if (metasCache && metasCache.key === key && Date.now() - metasCache.at < METAS_CACHE_MS) {
       
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reaproveita a última busca (menos de 5 min) ao voltar pra aba
      setInsights(metasCache.insights);
      return;
    }
     
    void load();
  }, [load, accounts]);

  // Calendário só é calculado no cliente, no momento do render da aba — dias
  // decorridos do mês (contando hoje) e dias reais do mês, mesma base do Ritmo.
  const { elapsedDays, daysInMonth } = useMemo(() => metasCalendar(), []);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    const built = accounts
      .map<Row>((acc) => {
        const ins = insights[acc.account_id];
        const dailyBudget = ins?.daily_budget ?? 0;
        const rowRitmo = ritmoFromInsight(monthlyTargets[acc.account_id] ?? null, ins);
        return {
          accountId: acc.account_id,
          dailyBudget,
          ritmo: rowRitmo,
          accountName: acc.name,
          clientName: clientNames[acc.account_id] ?? acc.name,
          metas: computeMetas(
            {
              invested: ins?.spend ?? 0,
              monthlyTarget: monthlyTargets[acc.account_id] ?? null,
              cpa: ins?.cost_per_result ?? null,
              cpaTarget: cpaTargets[acc.account_id] ?? null,
              dailyBudget,
              ritmo: rowRitmo,
            },
            elapsedDays,
            daysInMonth,
          ),
        };
      })
      .filter((r) => !q || r.clientName.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q));
    built.sort((a, b) => compareMetas(a.metas, b.metas, sort));
    return built;
  }, [accounts, insights, clientNames, cpaTargets, monthlyTargets, sort, search, elapsedDays, daysInMonth]);

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
        Investimento atual e CPA = dia 01 até agora, contando o que já foi gasto hoje (atualiza ao clicar em Atualizar).{" "}
        Ideal até hoje = Investimento mensal ÷ {daysInMonth} dias do mês × {elapsedDays}{" "}
        {elapsedDays === 1 ? "dia" : "dias"} (dia de hoje, contando hoje), igual ao dashboard de referência.
      </p>

      {failedCount > 0 ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {failedCount} conta(s) não carregaram o gasto do mês (provável limite de requisições da Meta). Os números delas
          estão incompletos e o Ritmo fica em —. Clique em Atualizar pra tentar de novo.
          {firstFailError ? ` Motivo da Meta: ${firstFailError}` : ""}
        </p>
      ) : null}

      {error ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 text-right font-medium" title="Investimento mensal cadastrado (meta do mês)">
                Invest. mensal
              </th>
              <th className="px-4 py-2 text-right font-medium">Investimento atual</th>
              <th className="px-4 py-2 text-right font-medium">Ideal até hoje</th>
              <th className="px-4 py-2 font-medium" title="Investimento atual ÷ Investimento mensal cadastrado; o tracinho marca o ideal até hoje">
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
                title="Quanto investir por dia pra alcançar o Ideal até hoje, contando o que já foi gasto hoje: dentro de 80%–120% do ideal = investimento diário normal (Investimento mensal ÷ dias do mês); fora da faixa, ajusta pela diferença pro ideal, limitada a ±50% do normal"
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
                <tr
                  key={r.accountId}
                  className="group border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                >
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
                  <td className={"px-4 py-2 text-right tabular-nums"}>
                    {m.monthlyTarget != null ? fmtCurrency(m.monthlyTarget) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className={"px-4 py-2 text-right tabular-nums"}>
                    <div className={`text-base font-semibold ${investColor}`}>{fmtCurrency(m.invested)}</div>
                    {m.investDiff != null ? (
                      <div className={`text-xs opacity-70 ${investColor}`}>{fmtCurrencySigned(m.investDiff)}</div>
                    ) : null}
                  </td>
                  <td className={"px-4 py-2 text-right tabular-nums"}>{fmtCurrency(m.idealUntilToday)}</td>
                  <td className={"px-4 py-2"}>
                    <InvestCell m={m} elapsedDays={elapsedDays} daysInMonth={daysInMonth} />
                  </td>
                  <td className={"px-4 py-2 text-right tabular-nums"}>
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
                  <td
                    className={"px-4 py-2 text-right tabular-nums"}
                    title={ritmoTooltip(monthlyTargets[r.accountId] ?? null, insights[r.accountId])}
                  >
                    {fmtCurrency(r.ritmo)}
                  </td>
                  <td className={"px-4 py-2 text-right tabular-nums"}>
                    <div className={`text-base font-semibold ${cpaColor}`}>{fmtCurrency(m.cpa)}</div>
                    {m.cpaDiff != null ? (
                      <div className={`text-xs opacity-70 ${cpaColor}`}>{fmtCurrencySigned(m.cpaDiff)}</div>
                    ) : null}
                  </td>
                  <td className={"px-4 py-2 text-right tabular-nums"}>
                    {m.cpaTarget != null ? fmtCurrency(m.cpaTarget) : <span className="text-zinc-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sm text-zinc-500">
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
