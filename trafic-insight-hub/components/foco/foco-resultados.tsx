"use client";

import { useMemo } from "react";
import { fmtCurrency } from "@/lib/format";
import { CPA_ACCEPTABLE_BAND } from "@/lib/meta/metas";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";

// Modo Foco — quadro "Acompanhamento de Resultados" de UMA conta: os mesmos números do Desempenho (Leads, Valor usado, CPA e a diferença pro CPA ideal)
// em vários períodos + o CPA de cada dia (últimos 14 dias com hoje), como em Evolução. Só mostra; quem busca os dados é a página.

function shift(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function todayBr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const wd = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

// Verde: no ideal ou abaixo; laranja: até R$ 2,50 acima; vermelho: mais que isso. Sem CPA ideal, sem cor.
export function cpaCls(cpa: number | null, target: number | null | undefined): string {
  if (cpa == null) return "text-zinc-400";
  if (target == null) return "";
  const diff = cpa - target;
  if (diff <= 0) return "text-emerald-600 dark:text-emerald-400";
  if (diff <= CPA_ACCEPTABLE_BAND) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

interface Agg {
  spend: number;
  results: number;
  cpa: number | null;
}
const agg = (pts: DailyCpaPoint[]): Agg => {
  const spend = pts.reduce((s, p) => s + p.spend, 0);
  const results = pts.reduce((s, p) => s + p.results, 0);
  return { spend, results, cpa: results > 0 && spend > 0 ? spend / results : null };
};

export function FocoResultados({
  daily,
  month,
  cpaTarget,
}: {
  daily: DailyCpaPoint[];
  month: DailyCpaPoint | null;
  cpaTarget: number | null;
}) {
  const today = todayBr();
  const byDate = useMemo(() => new Map(daily.map((p) => [p.date, p])), [daily]);
  const range = (from: number, to: number) => {
    const out: DailyCpaPoint[] = [];
    for (let i = from; i <= to; i++) {
      const p = byDate.get(shift(today, -i));
      if (p) out.push(p);
    }
    return out;
  };
  const periods: Array<{ label: string; a: Agg }> = [
    { label: "Hoje", a: agg(range(0, 0)) },
    { label: "Ontem", a: agg(range(1, 1)) },
    { label: "Ontem e hoje", a: agg(range(0, 1)) },
    { label: "Últimos 3 dias + hoje", a: agg(range(0, 3)) },
    { label: "Últimos 7 dias + hoje", a: agg(range(0, 7)) },
    { label: "Mês atual", a: month ? { spend: month.spend, results: month.results, cpa: month.cpa } : { spend: 0, results: 0, cpa: null } },
  ];
  const days = Array.from({ length: 14 }, (_, i) => shift(today, -i));

  return (
    <div className="grid gap-4 p-3 xl:grid-cols-[minmax(340px,2fr)_3fr]">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Por período</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <th className="px-2 py-1.5 font-medium">Período</th>
              <th className="px-2 py-1.5 text-right font-medium">Leads</th>
              <th className="px-2 py-1.5 text-right font-medium">Valor usado</th>
              <th className="px-2 py-1.5 text-right font-medium">CPA</th>
              <th className="px-2 py-1.5 text-right font-medium" title="CPA menos o CPA ideal">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(({ label, a }) => {
              const diff = a.cpa != null && cpaTarget != null ? a.cpa - cpaTarget : null;
              return (
                <tr key={label} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-2 py-1.5 font-medium">{label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a.results}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(a.spend)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${cpaCls(a.cpa, cpaTarget)}`}>{a.cpa != null ? fmtCurrency(a.cpa) : "—"}</td>
                  <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${cpaCls(a.cpa, cpaTarget)}`}>
                    {diff != null ? `${diff > 0 ? "+" : "−"}${fmtCurrency(Math.abs(diff))}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">CPA por dia (últimos 14 dias)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-400 dark:border-zinc-800">
                <th className="px-2 py-1.5" />
                {days.map((d, i) => (
                  <th key={d} className="px-2 py-1.5 text-right font-medium">
                    <div className="tabular-nums">{dm(d)}</div>
                    <div className="text-[10px] font-normal">{i === 0 ? "Hoje" : i === 1 ? "Ontem" : wd(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-500">CPA</td>
                {days.map((d) => {
                  const p = byDate.get(d);
                  return (
                    <td key={d} className={`px-2 py-1.5 text-right font-semibold tabular-nums ${cpaCls(p?.cpa ?? null, cpaTarget)}`}>
                      {p?.cpa != null ? fmtCurrency(p.cpa) : "—"}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-500">Leads</td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-1.5 text-right tabular-nums">{byDate.get(d)?.results ?? 0}</td>
                ))}
              </tr>
              <tr>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-zinc-500">Valor usado</td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-1.5 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{fmtCurrency(byDate.get(d)?.spend ?? 0)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {cpaTarget != null ? `CPA ideal: ${fmtCurrency(cpaTarget)} — ` : "Sem CPA ideal cadastrado — "}verde no ideal ou abaixo, laranja até {fmtCurrency(CPA_ACCEPTABLE_BAND)} acima, vermelho acima disso.
        </p>
      </div>
    </div>
  );
}
