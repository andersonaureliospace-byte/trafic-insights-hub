"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCacheTime, isFresh, readTabCache, writeTabCache } from "@/lib/client-cache";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";
import { usePriorityOptions } from "@/lib/priority-context";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Quadro simples de evolução do CPA diário por cliente — período fixo em
// "últimos 7 dias + hoje" (8 colunas) + uma coluna fixa de mês atual, sem
// seletor de período, por pedido.
const DAYS_BACK = 7; // + hoje = 8 colunas de dia

// Etapa 48: cor de cada célula (diária ou mensal) agora compara com o CPA
// ideal cadastrado do cliente, mesma régua já usada na coluna CPA de
// Acompanhamento (cpaDiffColorClass em page.tsx) — só que com banda de R$2
// em vez de R$1,40, a pedido. Antes era um corte fixo em R$2 igual pra
// todo mundo, sem olhar o CPA ideal de cada um.
const ORANGE_BAND = 2;

interface DailyCpaPoint {
  date: string; // YYYY-MM-DD (ou "this_month" pro ponto do mês)
  spend: number;
  results: number;
  cpa: number | null;
}

const WEEKDAY_ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Aritmética de calendário em UTC (meio-dia fictício), só pra somar/subtrair
// dias sem risco de fuso horário empurrar a data errada — América/São Paulo
// não tem mais horário de verão, então isso é seguro.
function shiftDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatDateBR(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Hoje/Ontem/Anteontem cobrem os advérbios de verdade em português; do 3º
// dia pra trás não existe uma palavra única, então cai pro dia da semana.
function dayLabel(diffDays: number, iso: string): string {
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays === 2) return "Anteontem";
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Verde: CPA abaixo do ideal. Laranja: até R$2 acima do ideal. Vermelho:
// mais de R$2 acima. Sem CPA ideal cadastrado não dá pra comparar — fica
// sem cor (cinza padrão), igual ao resto do Painel nesse caso.
function evoColorClass(cpa: number | null, cpaTarget: number | null | undefined): string {
  if (cpa == null) return "text-zinc-400";
  if (cpaTarget == null) return "";
  const diff = cpa - cpaTarget;
  if (diff < 0) return "text-emerald-600 dark:text-emerald-400";
  if (diff <= ORANGE_BAND) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

export function EvolucaoTab({
  accounts,
  clientNames,
  cpaTargets,
  priorities,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  cpaTargets: Record<string, number | null>;
  // Etapa 143: Status (prioridade) de cada conta — alimenta o filtro de Status.
  priorities: Record<string, string | null>;
}) {
  const { options: priorityOptions } = usePriorityOptions();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [daily, setDaily] = useState<Record<string, DailyCpaPoint[]>>({});
  const [month, setMonth] = useState<Record<string, DailyCpaPoint>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    const today = todaySP();
    return Array.from({ length: DAYS_BACK + 1 }, (_, i) => shiftDate(today, -i));
  }, []);

  // Etapa 49: ordena do CPA mensal maior pro menor (quem está pior primeiro)
  // — conta sem dado de mês ainda vai pro final, não pro topo.
  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const ca = month[a.account_id]?.cpa;
      const cb = month[b.account_id]?.cpa;
      if (ca == null && cb == null) return 0;
      if (ca == null) return 1;
      if (cb == null) return -1;
      return cb - ca;
    });
  }, [accounts, month]);

  // Etapa 143: filtro de Status só esconde linhas na tela (não refaz a busca na Meta).
  const visibleAccounts = useMemo(
    () => (statusFilter === "all" ? sortedAccounts : sortedAccounts.filter((a) => (priorities[a.account_id] ?? "") === statusFilter)),
    [sortedAccounts, statusFilter, priorities],
  );

  // Etapa 124: backup no navegador — entrar na aba mostra o salvo e só busca na Meta se não tem nada
  // recente (1h); o ↻ Atualizar (force) sempre busca. Falhou? O salvo continua na tela.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const load = useCallback(async (force = false) => {
    if (accounts.length === 0) {
      setDaily({});
      setMonth({});
      return;
    }
    const backup = readTabCache<{ daily: typeof daily; month: typeof month }>("evolucao");
    if (backup) {
      setDaily(backup.data.daily);
      setMonth(backup.data.month);
      setSavedAt(backup.at);
      if (!force && isFresh(backup) && accounts.every((a) => backup.data.month[a.account_id] !== undefined || backup.data.daily[a.account_id] !== undefined)) return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/daily-cpa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: accounts.map((a) => a.account_id),
          days: DAYS_BACK + 1,
          includeToday: true,
          includeMonth: true,
        }),
      });
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      setDaily(d.daily ?? {});
      setMonth(d.month ?? {});
      setSavedAt(writeTabCache("evolucao", { daily: d.daily ?? {}, month: d.month ?? {} }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accounts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o CPA diário ao entrar na aba ou trocar a seleção de contas
    void load(false);
  }, [load]);

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Evolução {loading ? "· atualizando…" : savedAt ? `· atualizado às ${fmtCacheTime(savedAt)}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            CPA de cada dia (últimos 7 dias + hoje) e do mês atual, comparado com o CPA ideal de cada
            cliente — verde abaixo do ideal, laranja até R$2 acima, vermelho passando de R$2 acima.
            Ordenado pelo CPA do mês, do maior pro menor.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Prioridade</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
            >
              <option value="all">Todos</option>
              {priorityOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {loading ? "Atualizando…" : "↻ Atualizar"}
        </button>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 text-right font-medium">CPA ideal</th>
                <th className="px-3 py-2 text-right font-medium">
                  <div>Mensal</div>
                  <div className="text-[10px] font-normal normal-case text-zinc-400">Mês atual</div>
                </th>
                {dates.map((date, i) => (
                  <th key={date} className="px-3 py-2 text-right font-medium">
                    <div className="tabular-nums">{formatDateBR(date)}</div>
                    <div className="text-[10px] font-normal normal-case text-zinc-400">{dayLabel(i, date)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.length === 0 ? (
                <tr>
                  <td colSpan={3 + dates.length} className="px-4 py-6 text-center text-sm text-zinc-500">
                    Nenhum cliente com esse status.
                  </td>
                </tr>
              ) : null}
              {visibleAccounts.map((acc) => {
                const points = daily[acc.account_id] ?? [];
                const pointByDate = new Map(points.map((p) => [p.date, p]));
                const cpaTarget = cpaTargets[acc.account_id];
                const monthCpa = month[acc.account_id]?.cpa ?? null;
                return (
                  <tr key={acc.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2 font-medium">
                      <a
                        href={adsManagerUrl(acc.account_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir no Gerenciador de Anúncios"
                        className="underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        {clientNames[acc.account_id] ?? acc.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {cpaTarget == null ? "—" : fmtCurrency(cpaTarget)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium tabular-nums ${evoColorClass(monthCpa, cpaTarget)}`}
                      title={cpaTarget == null ? "Sem CPA ideal cadastrado" : undefined}
                    >
                      {monthCpa == null ? "—" : fmtCurrency(monthCpa)}
                    </td>
                    {dates.map((date) => {
                      const cpa = pointByDate.get(date)?.cpa ?? null;
                      return (
                        <td
                          key={date}
                          className={`px-3 py-2 text-right tabular-nums ${evoColorClass(cpa, cpaTarget)}`}
                          title={cpaTarget == null ? "Sem CPA ideal cadastrado" : undefined}
                        >
                          {cpa == null ? "—" : fmtCurrency(cpa)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
