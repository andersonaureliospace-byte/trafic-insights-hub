"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Monitor de CPA (Etapa 61) — quadro exclusivo de CPA, sempre do pior pro
// melhor, com o CPA ideal marcado dentro da barra. "Hoje", "Hoje e ontem" e
// "Mês atual" mudam a cada minuto e por isso são sempre buscados ao vivo na
// Meta (botão "Atualizar"); "Ontem" e "Últimos 3 dias" são dias fechados —
// vêm do cache que o hook cpa-board-cache-tick recalcula 1x por dia (ver
// lib/meta/cpa-board-cache.ts), sem bater na Meta a cada abertura da aba.
const WARNING_BAND = 2;

type Period = "today" | "yesterday" | "today_yesterday" | "last_3d" | "this_month";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "today_yesterday", label: "Hoje e ontem" },
  { id: "last_3d", label: "Últimos 3 dias" },
  { id: "this_month", label: "Este mês" },
];

const CACHED_PERIODS = new Set<Period>(["yesterday", "last_3d"]);

type Band = "good" | "warning" | "critical";

interface Row {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  cpa: number | null;
  diff: number | null;
}

function band(diff: number | null): Band | null {
  if (diff == null) return null;
  if (diff <= 0) return "good";
  if (diff <= WARNING_BAND) return "warning";
  return "critical";
}

const BAND_BG: Record<Band, string> = {
  good: "bg-emerald-500",
  warning: "bg-orange-500",
  critical: "bg-red-500",
};
const BAND_TEXT: Record<Band, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warning: "text-orange-600 dark:text-orange-400",
  critical: "text-red-600 dark:text-red-400",
};
const BAND_TEXT_ON_FILL: Record<Band, string> = {
  good: "text-white",
  warning: "text-zinc-900",
  critical: "text-white",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtAxis(v: number): string {
  return "R$" + Math.round(v);
}

export function MonitorCpaTab({
  accounts,
  clientNames,
  cpaTargets,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  cpaTargets: Record<string, number | null>;
}) {
  const [period, setPeriod] = useState<Period>("yesterday");
  const [insights, setInsights] = useState<Record<string, { cost_per_result: number | null }>>({});
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só entram no quadro contas com CPA ideal cadastrado — sem meta não dá
  // pra calcular diferença nem cor (mesmo critério do aviso de WhatsApp,
  // lib/alerts/cpa.ts).
  const accountsWithTarget = useMemo(
    () => accounts.filter((a) => cpaTargets[a.account_id] != null),
    [accounts, cpaTargets],
  );
  const accountsWithoutTarget = accounts.length - accountsWithTarget.length;

  const load = useCallback(async () => {
    if (accountsWithTarget.length === 0) {
      setInsights({});
      setCachedAt(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (CACHED_PERIODS.has(period)) {
        const res = await fetch("/api/meta/cpa-board-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset: period }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        setInsights(d.cache?.insights ?? {});
        setCachedAt(d.cache?.computed_at ?? null);
      } else {
        const accountIds = accountsWithTarget.map((a) => a.account_id);
        const res = await fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds, datePreset: period }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        setInsights(d.insights ?? {});
        setCachedAt(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accountsWithTarget, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao entrar na aba ou trocar de período/seleção de contas
    void load();
  }, [load]);

  async function calcularAgora() {
    setRefreshingCache(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/cpa-board-cache/refresh", { method: "POST" });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshingCache(false);
    }
  }

  const rows: Row[] = useMemo(() => {
    return accountsWithTarget
      .map((a) => {
        const cpaTarget = cpaTargets[a.account_id] as number;
        const cpa = insights[a.account_id]?.cost_per_result ?? null;
        const diff = cpa != null ? cpa - cpaTarget : null;
        return {
          accountId: a.account_id,
          clientName: clientNames[a.account_id] ?? a.name,
          cpaTarget,
          cpa,
          diff,
        };
      })
      .sort((x, y) => {
        // pior pro melhor, sempre — sem dado (diff null) vai pro final
        if (x.diff == null && y.diff == null) return 0;
        if (x.diff == null) return 1;
        if (y.diff == null) return -1;
        return y.diff - x.diff;
      });
  }, [accountsWithTarget, clientNames, cpaTargets, insights]);

  const max = useMemo(() => {
    const values = rows.map((r) => r.cpa ?? 0).filter((v) => v > 0);
    const target = rows.length > 0 ? Math.max(...rows.map((r) => r.cpaTarget)) : 0;
    return Math.max(...values, target, 1) * 1.15;
  }, [rows]);

  const axisTicks = useMemo(() => {
    const raw = max / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / magnitude;
    const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = niceNorm * magnitude;
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    return ticks;
  }, [max]);

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? "";
  const isCached = CACHED_PERIODS.has(period);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Monitor de CPA {loading ? "· atualizando…" : ""}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            CPA de cada cliente comparado com o CPA ideal cadastrado, do pior pro melhor.{" "}
            {isCached
              ? cachedAt
                ? `Dados de ${periodLabel} atualizados automaticamente 1x por dia (última vez às ${fmtTime(cachedAt)}).`
                : "Dados desse período ainda não foram calculados pela primeira vez."
              : "Sempre ao vivo — clique em Atualizar pra buscar de novo na Meta."}
          </p>
        </div>
        {isCached ? (
          <button
            onClick={() => void calcularAgora()}
            disabled={refreshingCache}
            className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {refreshingCache ? "Calculando…" : "Calcular agora"}
          </button>
        ) : (
          <button
            onClick={() => void load()}
            disabled={loading}
            className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              period === p.id
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          Nenhuma conta selecionada tem CPA ideal cadastrado ainda — cadastre em Painel → Clientes.
        </p>
      ) : (
        <div className="px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Crítico (acima de R$2,00)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> Atenção (até R$2,00 acima)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Dentro da meta
            </span>
            <span className="h-3.5 w-px bg-zinc-300 dark:bg-zinc-700" />
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 bg-zinc-900 dark:bg-zinc-100" /> CPA ideal
            </span>
          </div>

          <div className="flex flex-col">
            {rows.map((r) => {
              const b = band(r.diff);
              const cpaPct = r.cpa != null ? Math.min(100, (r.cpa / max) * 100) : 0;
              const idealPct = Math.min(100, (r.cpaTarget / max) * 100);
              const tooNarrow = idealPct < 11;
              return (
                <div
                  key={r.accountId}
                  className="grid grid-cols-[130px_1fr_70px_82px] items-center gap-2.5 border-t border-zinc-100 py-1.5 first:border-t-0 dark:border-zinc-800/60 sm:grid-cols-[190px_1fr_74px_96px]"
                >
                  <a
                    href={adsManagerUrl(r.accountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir no Gerenciador de Anúncios"
                    className="truncate text-sm font-medium text-zinc-900 underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
                  >
                    {r.clientName}
                  </a>

                  <div className="relative h-[22px] rounded bg-zinc-100 dark:bg-zinc-800">
                    {b ? (
                      <div
                        className={`absolute inset-y-0 left-0 rounded ${BAND_BG[b]}`}
                        style={{ width: `${cpaPct}%` }}
                      />
                    ) : null}
                    {b && !tooNarrow ? (
                      <div
                        className={`absolute inset-y-0 left-0 flex items-center justify-end overflow-hidden whitespace-nowrap pr-1.5 text-[11px] font-semibold tabular-nums ${BAND_TEXT_ON_FILL[b]}`}
                        style={{ width: `${idealPct}%` }}
                      >
                        {fmtCurrency(r.cpaTarget)}
                      </div>
                    ) : null}
                    <div
                      className="absolute -top-[3px] h-[28px] w-0.5 bg-zinc-900 opacity-60 dark:bg-zinc-100"
                      style={{ left: `${idealPct}%` }}
                      title={`CPA ideal: ${fmtCurrency(r.cpaTarget)}`}
                    />
                    {b && tooNarrow ? (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-400"
                        style={{ left: `${idealPct}%` }}
                      >
                        {fmtCurrency(r.cpaTarget)}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={`text-right text-[12.5px] font-bold tabular-nums whitespace-nowrap ${
                      b ? BAND_TEXT[b] : "text-zinc-400"
                    }`}
                  >
                    {r.diff == null ? "—" : fmtCurrencySigned(r.diff)}
                  </div>

                  <div className="text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{fmtCurrency(r.cpa)}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 grid grid-cols-[130px_1fr_70px_82px] gap-2.5 sm:grid-cols-[190px_1fr_74px_96px]">
            <div />
            <div className="relative h-3.5">
              {axisTicks.map((v) => (
                <span
                  key={v}
                  className="absolute top-0 -translate-x-1/2 text-[10px] text-zinc-400"
                  style={{ left: `${(v / max) * 100}%` }}
                >
                  {fmtAxis(v)}
                </span>
              ))}
            </div>
            <div />
            <div />
          </div>

          <p className="mt-2 text-[11px] text-zinc-400">
            O número dentro da barra, junto do tracinho, é o CPA ideal; logo depois da barra vem a diferença; e a
            coluna da direita mostra o CPA real.
          </p>

          {accountsWithoutTarget > 0 ? (
            <p className="mt-3 text-xs text-zinc-400">
              {accountsWithoutTarget} conta{accountsWithoutTarget > 1 ? "s" : ""} sem CPA ideal cadastrado não
              aparece{accountsWithoutTarget > 1 ? "m" : ""} aqui — cadastre em Painel → Clientes.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
