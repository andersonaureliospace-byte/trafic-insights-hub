"use client";

import { useMemo } from "react";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import type { AccountInsight } from "@/lib/meta/insights";
import { ritmoColorClass } from "@/lib/meta/ritmo";
import { computeSpeed, speedBudgetTooltip, speedCpaStatus } from "@/lib/meta/speed";

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

export function FocoResultados({
  daily,
  month,
  cpaTarget,
  insight,
  monthlyTarget,
  untilYesterday,
}: {
  daily: DailyCpaPoint[];
  month: DailyCpaPoint | null;
  cpaTarget: number | null;
  insight?: AccountInsight | null;
  monthlyTarget?: number | null;
  untilYesterday?: number | null;
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
  // Rodapé: Invest. diário grande e, embaixo, a diferença pro "Gastar amanhã" da Speed (lib/meta/speed.ts) — o MESMO número do quadro
  // Acompanhamento de metas (Etapa 188; antes comparava com o Ritmo antigo e dava outro valor na mesma tela). Só com o mês carregado.
  const budget = insight && !insight.insights_failed ? insight.daily_budget : null;
  const sp = insight && !insight.insights_failed
    ? computeSpeed({ monthlyTarget: monthlyTarget ?? null, spentSoFar: insight.spend, spentUntilYesterday: untilYesterday ?? null, cpa: null, cpaTarget: null })
    : null;
  const rit = sp?.gastarAmanha ?? null;
  const ritDiff = rit != null && budget != null ? budget - rit : null;
  const ritCls = ritmoColorClass(rit, budget ?? undefined);
  const tip = sp ? speedBudgetTooltip(sp, monthlyTarget ?? null) : undefined;
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
      {budget != null ? (
        <tfoot>
          <tr className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="px-3 py-2 font-medium" title={tip}>
              Invest. diário
            </td>
            <td colSpan={3} className="px-3 py-1.5 text-right tabular-nums" title={tip}>
              <div className={`font-semibold ${ritCls}`}>{fmtCurrency(budget)}</div>
              {ritDiff != null ? (
                <div className={`text-[11px] leading-tight ${ritCls}`} title="Invest. diário menos o Gastar amanhã (regra da Speed)">
                  {fmtCurrencySigned(ritDiff)} · amanhã {rit != null ? fmtCurrency(rit) : "—"}
                </div>
              ) : null}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
