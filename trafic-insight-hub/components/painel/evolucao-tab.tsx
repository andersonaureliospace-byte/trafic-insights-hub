"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";

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
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  cpaTargets: Record<string, number | null>;
}) {
  const [daily, setDaily] = useState<Record<string, DailyCpaPoint[]>>({});
  const [month, setMonth] = useState<Record<string, DailyCpaPoint>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    const today = todaySP();
    return Array.from({ length: DAYS_BACK + 1 }, (_, i) => shiftDate(today, -i));
  }, []);

  const load = useCallback(async () => {
    if (accounts.length === 0) {
      setDaily({});
      setMonth({});
      return;
    }
    setLoading(true);
    setError(null);
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
    setLoading(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setDaily(d.daily ?? {});
    setMonth(d.month ?? {});
  }, [accounts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o CPA diário ao entrar na aba ou trocar a seleção de contas
    void load();
  }, [load]);

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Evolução {loading ? "· atualizando…" : ""}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            CPA de cada dia (últimos 7 dias + hoje) e do mês atual, comparado com o CPA ideal de cada
            cliente — verde abaixo do ideal, laranja até R$2 acima, vermelho passando de R$2 acima.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {loading ? "Atualizando…" : "↻ Atualizar"}
        </button>
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">Cliente</th>
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
              {accounts.map((acc) => {
                const points = daily[acc.account_id] ?? [];
                const pointByDate = new Map(points.map((p) => [p.date, p]));
                const cpaTarget = cpaTargets[acc.account_id];
                const monthCpa = month[acc.account_id]?.cpa ?? null;
                return (
                  <tr key={acc.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2 font-medium">{clientNames[acc.account_id] ?? acc.name}</td>
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
