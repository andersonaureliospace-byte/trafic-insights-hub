"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCacheTime, isFresh, readTabCache, writeTabCache } from "@/lib/client-cache";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { monthCalendarSP, ritmoColorClass } from "@/lib/meta/ritmo";
import {
  SPEED_CPA_ACCEPTABLE,
  SPEED_CPA_LABEL,
  SPEED_INVEST_LABEL,
  computeSpeed,
  speedBudgetTooltip,
  speedOkText,
  speedSortKey,
  type SpeedCpa,
  type SpeedInvest,
  type SpeedRow,
} from "@/lib/meta/speed";

// Acompanhamento de metas — análise isolada de TODAS as contas, com as regras da Speed (Etapa 186, lib/meta/speed.ts):
// Cliente | Investido até agora | Status (Speed) | Gastar hoje ⇄ amanhã | CPA (Speed). Meta mensal, ideal e CPA ideal ficam na dica.
// Investido/CPA = dia 01 até agora (com hoje). Status do investimento = gasto até ONTEM × ideal até HOJE, folga de 2% (igual Speed).
// Duas buscas: mês até agora (CPA + orçamento) e mês até ontem (só gasto; vem do backup diário, quase sem chamada à Meta).

interface MetasInsight {
  spend: number;
  cost_per_result: number | null;
  daily_budget: number;
  insights_failed?: boolean;
  insights_error?: string;
}

// Etapa 90/124: backup no navegador — entrar na aba mostra o salvo e só busca se não tem nada recente (1h); ↻ Atualizar sempre busca.
const CACHE_MONTH = "metas";
const CACHE_UNTIL = "metas-ate-ontem";

type Sort = "critical" | "invest" | "cpa";
const SORTS: { id: Sort; label: string }[] = [
  { id: "critical", label: "Fora da meta (Speed) → mais tranquilas" },
  { id: "invest", label: "Investimento (maior diferença → menor)" },
  { id: "cpa", label: "CPA (maior diferença acima da meta → menor)" },
];

interface Row {
  accountId: string;
  accountName: string;
  clientName: string;
  monthlyTarget: number | null;
  invested: number | null;
  untilYesterday: number | null;
  dailyBudget: number | null;
  s: SpeedRow;
}

const INVEST_BAR: Record<SpeedInvest, string> = { below: "bg-orange-500", ok: "bg-emerald-500", above: "bg-red-500" };
const INVEST_TEXT: Record<SpeedInvest, string> = {
  below: "text-orange-600 dark:text-orange-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  above: "text-red-600 dark:text-red-400",
};
const INVEST_PILL: Record<SpeedInvest, string> = {
  below: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  above: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const CPA_TEXT: Record<SpeedCpa, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};
const pctTxt = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const MISSING = Number.NEGATIVE_INFINITY;

function sortKey(r: Row, sort: Sort): number {
  if (sort === "critical") return speedSortKey(r.s);
  if (sort === "invest") return r.s.speedDiffPct != null ? Math.abs(r.s.speedDiffPct) : MISSING;
  return r.s.cpaDiff ?? MISSING;
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
  const [insights, setInsights] = useState<Record<string, MetasInsight>>({});
  const [until, setUntil] = useState<Record<string, MetasInsight>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("critical");
  const [search, setSearch] = useState("");
  const [budgetMode, setBudgetMode] = useState<"hoje" | "amanha">("amanha");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const firstFailError = Object.values(insights).find((i) => i.insights_error)?.insights_error;
  const failedCount =
    Object.keys(insights).length === 0
      ? 0
      : accounts.filter((a) => !insights[a.account_id] || insights[a.account_id]?.insights_failed).length;

  const load = useCallback(
    async (force = false) => {
      if (accounts.length === 0) {
        setInsights({});
        return;
      }
      const ids = accounts.map((a) => a.account_id);
      const backup = readTabCache<Record<string, MetasInsight>>(CACHE_MONTH);
      const backupUntil = readTabCache<Record<string, MetasInsight>>(CACHE_UNTIL);
      const sameDay = (at: number) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(at) ===
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(Date.now());
      if (backup) {
        setInsights(backup.data);
        setSavedAt(backup.at);
      }
      if (backupUntil && sameDay(backupUntil.at)) setUntil(backupUntil.data);
      if (
        !force &&
        backup &&
        isFresh(backup) &&
        backupUntil &&
        sameDay(backupUntil.at) &&
        ids.every((id) => backup.data[id] && !backup.data[id]?.insights_failed)
      )
        return;
      setLoading(true);
      setError(null);
      try {
        const call = async (body: Record<string, unknown>) => {
          const res = await fetch("/api/meta/insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountIds: ids, ...body }),
          });
          const d = await res.json();
          if (d.error) throw new Error(d.error);
          return (d.insights ?? {}) as Record<string, MetasInsight>;
        };
        const fresh = await call({ datePreset: "this_month" });
        const failedAll = Object.keys(fresh).length > 0 && Object.values(fresh).every((v) => v.insights_failed);
        if (!(failedAll && backup)) {
          setInsights(fresh);
          setSavedAt(writeTabCache(CACHE_MONTH, fresh));
        }
        if (monthCalendarSP().day > 1) {
          const u = await call({ datePreset: "this_month_until_yesterday", spendOnly: true });
          setUntil(u);
          writeTabCache(CACHE_UNTIL, u);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [accounts],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mostra o backup e só busca se não há dado recente
    void load(false);
  }, [load]);

  const cal = useMemo(() => monthCalendarSP(), []);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    const built = accounts
      .map<Row>((acc) => {
        const ins = insights[acc.account_id];
        const ok = ins && !ins.insights_failed ? ins : null;
        const u = until[acc.account_id];
        const untilYesterday = cal.day === 1 ? 0 : u && !u.insights_failed ? u.spend : null;
        const monthlyTarget = monthlyTargets[acc.account_id] ?? null;
        return {
          accountId: acc.account_id,
          accountName: acc.name,
          clientName: clientNames[acc.account_id] ?? acc.name,
          monthlyTarget,
          invested: ok?.spend ?? null,
          untilYesterday,
          dailyBudget: ok?.daily_budget ?? null,
          s: computeSpeed({
            monthlyTarget,
            spentSoFar: ok?.spend ?? null,
            spentUntilYesterday: untilYesterday,
            cpa: ok?.cost_per_result ?? null,
            cpaTarget: cpaTargets[acc.account_id] ?? null,
            dailyBudget: ok?.daily_budget ?? null,
          }),
        };
      })
      .filter((r) => !q || r.clientName.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q));
    built.sort((a, b) => {
      const ka = sortKey(a, sort);
      const kb = sortKey(b, sort);
      if (ka === kb) return a.clientName.localeCompare(b.clientName, "pt-BR");
      return kb > ka ? 1 : -1;
    });
    return built;
  }, [accounts, insights, until, clientNames, cpaTargets, monthlyTargets, sort, search, cal]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Acompanhamento de metas {loading ? "· atualizando…" : ""}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou conta…"
            className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
          {savedAt && !loading ? <span className="text-xs text-zinc-400">atualizado às {fmtCacheTime(savedAt)}</span> : null}
        </div>
      </div>

      <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        Regras da Speed com o dado ao vivo. Investido e CPA = dia 01 até agora, contando hoje. Status do investimento = gasto até ontem × ideal até
        hoje (meta ÷ {cal.daysInMonth} dias × {cal.day}), folga de 2%. CPA = investimento total ÷ conversas; Aceitável = até{" "}
        {fmtCurrency(SPEED_CPA_ACCEPTABLE)} acima do ideal. Gastar hoje/amanhã mira a meta cheia, com teto de 2x o ritmo médio por dia.
      </p>

      {failedCount > 0 ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {failedCount} conta(s) não carregaram o gasto do mês (provável limite de requisições da Meta). Os números delas estão incompletos. Clique em
          Atualizar pra tentar de novo.
          {firstFailError ? ` Motivo da Meta: ${firstFailError}` : ""}
        </p>
      ) : null}

      {error ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{error}</div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 text-right font-medium" title="Gasto do dia 01 até agora (com hoje). Embaixo: o que a Speed vê (até ontem) × ideal até hoje">
                Investido até agora
              </th>
              <th className="px-4 py-2 font-medium" title="Status de investimento da Speed: gasto até ontem × ideal até hoje, folga de 2%">
                Status (Speed)
              </th>
              <th className="px-4 py-2 text-right font-medium">
                <button
                  type="button"
                  onClick={() => setBudgetMode((m) => (m === "hoje" ? "amanha" : "hoje"))}
                  title={budgetMode === "hoje" ? "Gastar hoje: quanto ainda falta gastar hoje. Clique pra ver Gastar amanhã." : "Gastar amanhã: orçamento pra configurar. Clique pra ver Gastar hoje."}
                  className="font-medium uppercase tracking-wide text-sky-600 underline decoration-dotted underline-offset-2 hover:text-sky-800 dark:text-sky-400"
                >
                  {budgetMode === "hoje" ? "Gastar hoje ⇄" : "Gastar amanhã ⇄"}
                </button>
              </th>
              <th className="px-4 py-2 text-right font-medium" title="CPA do mês (investimento total ÷ conversas). Embaixo: diferença pro CPA ideal">
                CPA (Speed)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r.s;
              const investColor = s.investStatus ? INVEST_TEXT[s.investStatus] : "";
              const cpaColor = s.cpaStatus ? CPA_TEXT[s.cpaStatus] : "";
              const fill = r.monthlyTarget && r.invested != null ? Math.min(r.invested / r.monthlyTarget, 1) * 100 : 0;
              const marker = Math.min((s.day / s.daysInMonth) * 100, 100);
              const investTip =
                r.monthlyTarget != null
                  ? `Meta do mês: ${fmtCurrency(r.monthlyTarget)}\nIdeal até hoje: ${fmtCurrency(s.idealToday)}\nAté ontem (o que a Speed vê): ${fmtCurrency(r.untilYesterday)}\nInvestido até agora: ${fmtCurrency(r.invested)}`
                  : "Sem Investimento mensal cadastrado";
              const budgetVal = budgetMode === "hoje" ? s.gastarHoje : s.gastarAmanha;
              const budgetCls = budgetMode === "amanha" && s.gastarAmanha != null && r.dailyBudget != null ? ritmoColorClass(s.gastarAmanha, r.dailyBudget) : "";
              return (
                <tr key={r.accountId} className="group border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2">
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">{r.clientName}</div>
                    <a
                      href={adsManagerUrl(r.accountId, "this_month")}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir no Gerenciador de Anúncios"
                      className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {r.accountName}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" title={investTip}>
                    <div className={`text-base font-semibold ${investColor}`}>{fmtCurrency(r.invested)}</div>
                    {s.speedDiff != null && s.speedDiffPct != null ? (
                      <div className={`text-xs opacity-70 ${investColor}`}>
                        até ontem {fmtCurrencySigned(s.speedDiff)} · {pctTxt(s.speedDiffPct)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2" title={investTip}>
                    {r.monthlyTarget == null ? (
                      <span className="text-xs text-zinc-400">Sem Investimento mensal</span>
                    ) : (
                      <div className="w-40 space-y-1">
                        {s.investStatus ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${INVEST_PILL[s.investStatus]}`}>{SPEED_INVEST_LABEL[s.investStatus]}</span>
                        ) : (
                          <span className="text-xs text-zinc-400">sem gasto até ontem</span>
                        )}
                        <div className="relative h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div className={`h-full rounded-full ${s.investStatus ? INVEST_BAR[s.investStatus] : "bg-zinc-400"}`} style={{ width: `${fill}%` }} />
                          <div className="absolute -top-0.5 h-2.5 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${marker}%` }} />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" title={speedBudgetTooltip(s, r.monthlyTarget)}>
                    <div className={`text-base font-semibold ${budgetCls}`}>{budgetVal != null ? fmtCurrency(budgetVal) : <span className="text-zinc-400">—</span>}</div>
                    {budgetMode === "amanha" && budgetVal != null && r.dailyBudget != null ? (
                      <div className={`text-xs opacity-70 ${budgetCls}`}>orçamento {fmtCurrency(r.dailyBudget)}</div>
                    ) : budgetMode === "hoje" && s.investStatus != null && s.okInDays !== 0 ? (
                      <div className="text-xs text-orange-600 opacity-80 dark:text-orange-400">{speedOkText(s)}</div>
                    ) : null}
                  </td>
                  <td
                    className="px-4 py-2 text-right tabular-nums"
                    title={`CPA ideal: ${s.cpaTarget != null ? fmtCurrency(s.cpaTarget) : "não cadastrado"}${s.cpaStatus ? ` · Speed: ${SPEED_CPA_LABEL[s.cpaStatus]}` : ""}`}
                  >
                    <div className={`text-base font-semibold ${cpaColor}`}>{fmtCurrency(s.cpa)}</div>
                    {s.cpaDiff != null ? (
                      <div className={`text-xs opacity-70 ${cpaColor}`}>
                        {s.cpaStatus ? `${SPEED_CPA_LABEL[s.cpaStatus]} · ` : ""}
                        {fmtCurrencySigned(s.cpaDiff)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
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
