"use client";

import { useMemo } from "react";
import { fmtCurrency } from "@/lib/format";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import { speedCpaStatus } from "@/lib/meta/speed";

// Modo Foco — quadro "Acompanhamento de Resultados" de UMA conta: os mesmos números do Desempenho (Leads, Valor usado e CPA, com a diferença pro CPA ideal
// pequena embaixo do CPA) em vários períodos. Só mostra; quem busca os dados é a página.

function shift(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function todayBr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Etapa 188: cores pela régua da Speed — verde: no ideal ou abaixo; laranja: Aceitável (até R$ 1,20 acima); vermelho: Acima. Sem CPA ideal, sem cor.
export function cpaCls(cpa: number | null, target: number | null | undefined): string {
  if (cpa == null) return "text-zinc-400";
  const st = speedCpaStatus(cpa, target ?? null);
  if (st == null) return "";
  if (st === "ok") return "text-emerald-600 dark:text-emerald-400";
  if (st === "acceptable") return "text-orange-600 dark:text-orange-400";
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

export function FocoResultados({ daily, cpaTarget }: { daily: DailyCpaPoint[]; cpaTarget: number | null }) {
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
  ];
  // Etapa 189: "Últimos 7 dias + hoje", "Mês atual" e o rodapé "Invest. diário" saíram daqui — o mês e o orçamento já estão no quadro
  // Acompanhamento de metas, e com 4 linhas o quadro cabe sem barra de rolagem.
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
          <th className="px-3 py-1.5 font-medium">Período</th>
          <th className="px-3 py-1.5 text-right font-medium">Leads</th>
          <th className="px-3 py-1.5 text-right font-medium">Valor usado</th>
          <th className="px-3 py-1.5 text-right font-medium">CPA</th>
        </tr>
      </thead>
      <tbody>
        {periods.map(({ label, a }) => {
          const diff = a.cpa != null && cpaTarget != null ? a.cpa - cpaTarget : null;
          return (
            <tr key={label} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
              <td className="px-3 py-2 font-medium">{label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.results}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(a.spend)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                <div className={`font-semibold ${cpaCls(a.cpa, cpaTarget)}`}>{a.cpa != null ? fmtCurrency(a.cpa) : "—"}</div>
                {diff != null ? (
                  <div className={`text-[11px] leading-tight ${cpaCls(a.cpa, cpaTarget)}`} title="CPA menos o CPA ideal">
                    {diff > 0 ? "+" : "−"}
                    {fmtCurrency(Math.abs(diff))}
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
