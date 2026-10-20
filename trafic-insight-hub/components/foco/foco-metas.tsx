"use client";

import { useMemo } from "react";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { computeMetas, metasCalendar, type CpaStatus, type InvestStatus } from "@/lib/meta/metas";
import { ritmoColorClass, ritmoFromInsight, ritmoTooltip } from "@/lib/meta/ritmo";
import type { AccountInsight } from "@/lib/meta/insights";

// Modo Foco — quadro "Acompanhamento de metas" de UMA conta: investimento do mês × ideal até hoje, CPA do mês × CPA ideal e Invest. diário × Ritmo
// (as mesmas contas das abas Metas e Desempenho). Só mostra; quem busca o mês é a página.

const INVEST_BAR: Record<InvestStatus, string> = { below: "bg-orange-500", ok: "bg-emerald-500", above: "bg-red-500" };
const INVEST_TEXT: Record<InvestStatus, string> = {
  below: "text-orange-600 dark:text-orange-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  above: "text-red-600 dark:text-red-400",
};
const INVEST_LABEL: Record<InvestStatus, string> = { below: "Abaixo do ideal", ok: "Dentro do ideal", above: "Acima do ideal" };
const CPA_TEXT: Record<CpaStatus, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};
const CPA_LABEL: Record<CpaStatus, string> = { good: "No ideal ou abaixo", acceptable: "Até R$ 2,50 acima", high: "Mais de R$ 2,50 acima" };

export function FocoMetas({
  insight,
  cpaTarget,
  monthlyTarget,
  whatsapp,
}: {
  insight: AccountInsight | null;
  cpaTarget: number | null;
  monthlyTarget: number | null;
  whatsapp?: string | null;
}) {
  const { elapsedDays, daysInMonth } = useMemo(() => metasCalendar(), []);
  if (!insight || insight.insights_failed) {
    return (
      <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        {insight?.insights_failed ? `A Meta não devolveu o gasto do mês desta conta${insight.insights_error ? ` (${insight.insights_error})` : ""}. Clique em Atualizar.` : "Carregando…"}
      </p>
    );
  }
  const rit = ritmoFromInsight(monthlyTarget, insight);
  const m = computeMetas(
    { invested: insight.spend, monthlyTarget, cpa: insight.cost_per_result, cpaTarget, dailyBudget: insight.daily_budget, ritmo: rit },
    elapsedDays,
    daysInMonth,
  );
  const fill = m.pctOfTarget != null ? Math.min(m.pctOfTarget, 1) * 100 : 0;
  const marker = Math.min((elapsedDays / daysInMonth) * 100, 100);

  return (
    <div className="space-y-4 p-4">
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Investimento do mês</p>
          {m.investStatus ? <span className={`text-xs font-medium ${INVEST_TEXT[m.investStatus]}`}>{INVEST_LABEL[m.investStatus]}</span> : null}
        </div>
        {m.monthlyTarget == null ? (
          <p className="mt-1 text-sm text-zinc-500">
            Investido <span className="font-semibold text-zinc-900 dark:text-zinc-50">{fmtCurrency(m.invested)}</span> — sem Investimento mensal cadastrado.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              <span className={`text-lg font-semibold tabular-nums ${m.investStatus ? INVEST_TEXT[m.investStatus] : ""}`}>{fmtCurrency(m.invested)}</span>
              <span className="text-zinc-500"> de {fmtCurrency(m.monthlyTarget)} ({Math.round((m.pctOfTarget ?? 0) * 100)}%)</span>
            </p>
            <div className="relative mt-1.5 h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className={`h-full rounded-full ${m.investStatus ? INVEST_BAR[m.investStatus] : "bg-zinc-400"}`} style={{ width: `${fill}%` }} />
              <div className="absolute -top-0.5 h-3 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${marker}%` }} title="Ideal até hoje" />
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ideal até hoje (dia {elapsedDays}): {fmtCurrency(m.idealUntilToday ?? 0)}
              {m.investDiff != null ? (
                <>
                  {" "}— diferença <span className={m.investStatus ? INVEST_TEXT[m.investStatus] : ""}>{fmtCurrencySigned(m.investDiff)}</span>
                </>
              ) : null}
            </p>
          </>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">CPA do mês</p>
          {m.cpaStatus ? <span className={`text-xs font-medium ${CPA_TEXT[m.cpaStatus]}`}>{CPA_LABEL[m.cpaStatus]}</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className={`text-lg font-semibold tabular-nums ${m.cpaStatus ? CPA_TEXT[m.cpaStatus] : ""}`}>{m.cpa != null ? fmtCurrency(m.cpa) : "—"}</span>
          <span className="inline-flex items-baseline gap-1.5 rounded-md bg-sky-100 px-2.5 py-1 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700">
            <span className="text-xs font-semibold uppercase tracking-wide">CPA ideal</span>
            <span className="text-lg font-bold tabular-nums">{cpaTarget != null ? fmtCurrency(cpaTarget) : "não cadastrado"}</span>
          </span>
          {m.cpaDiff != null ? <span className="text-xs text-zinc-500 dark:text-zinc-400">diferença {fmtCurrencySigned(m.cpaDiff)}</span> : null}
        </div>
      </section>

      <section>
        <div title={ritmoTooltip(monthlyTarget, insight)}>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Invest. diário × Ritmo</p>
        {rit == null ? (
          <p className="mt-1 text-sm text-zinc-500">Sem Investimento mensal cadastrado — não dá pra calcular o Ritmo.</p>
        ) : (
          <p className="mt-1 text-sm">
            Orçamento diário <span className="font-semibold tabular-nums">{fmtCurrency(insight.daily_budget)}</span>
            <span className="text-zinc-500"> · precisa investir </span>
            <span className={`font-semibold tabular-nums ${ritmoColorClass(rit, insight.daily_budget)}`}>{fmtCurrency(rit)}</span>
            <span className="text-zinc-500"> por dia (Ritmo)</span>
            {m.dailyDiff != null ? <span className={`ml-1 text-xs ${ritmoColorClass(rit, insight.daily_budget)}`}>({fmtCurrencySigned(m.dailyDiff)})</span> : null}
          </p>
        )}
        </div>
        <p className="mt-1 text-sm" title="Investimento mensal ÷ dias do mês (o mesmo do balão do nome no Desempenho)">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Ritmo médio</span>{" "}
          {monthlyTarget != null && monthlyTarget > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{fmtCurrency(monthlyTarget / daysInMonth)}</span>
              <span className="text-zinc-500"> por dia</span>
            </>
          ) : (
            <span className="text-zinc-500">não cadastrado</span>
          )}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">WhatsApp</span>{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{whatsapp?.trim() ? whatsapp.trim() : <span className="font-normal text-zinc-500">não cadastrado</span>}</span>
        </p>
      </section>
    </div>
  );
}
