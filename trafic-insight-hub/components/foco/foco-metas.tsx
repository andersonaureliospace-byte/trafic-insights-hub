"use client";

import { useMemo } from "react";
import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { computeMetas, metasCalendar, type CpaStatus, type InvestStatus } from "@/lib/meta/metas";
import { ritmoColorClass, ritmoFromInsight, ritmoTooltip } from "@/lib/meta/ritmo";
import type { AccountInsight } from "@/lib/meta/insights";

// Modo Foco — quadro "Acompanhamento de metas" de UMA conta, em 4 blocos com a mesma hierarquia (rótulo pequeno → número grande → uma linha de apoio):
// Investimento do mês, CPA do mês × CPA ideal, Orçamento e ritmo, WhatsApp. As contas são as mesmas das abas Metas e Desempenho. Só mostra; quem busca o mês é a página.

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-zinc-400";
const SUB = "text-xs text-zinc-500 dark:text-zinc-400";

const INVEST_BAR: Record<InvestStatus, string> = { below: "bg-orange-500", ok: "bg-emerald-500", above: "bg-red-500" };
const INVEST_TEXT: Record<InvestStatus, string> = {
  below: "text-orange-600 dark:text-orange-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  above: "text-red-600 dark:text-red-400",
};
const INVEST_PILL: Record<InvestStatus, string> = {
  below: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  above: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const INVEST_LABEL: Record<InvestStatus, string> = { below: "Abaixo do ideal", ok: "Dentro do ideal", above: "Acima do ideal" };
const CPA_TEXT: Record<CpaStatus, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  acceptable: "text-orange-600 dark:text-orange-400",
  high: "text-red-600 dark:text-red-400",
};
const CPA_PILL: Record<CpaStatus, string> = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  acceptable: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const CPA_BANDS = "Verde: no ideal ou abaixo · Laranja: até R$ 2,50 acima do ideal · Vermelho: mais de R$ 2,50 acima do ideal";

function Pill({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

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
  const avg = monthlyTarget != null && monthlyTarget > 0 ? monthlyTarget / daysInMonth : null;
  const dailyCls = rit != null ? ritmoColorClass(rit, insight.daily_budget) : "";
  const wa = whatsapp?.trim();

  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {/* 1 · Investimento do mês */}
      <section className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>Investimento do mês</p>
          {m.investStatus ? <Pill cls={INVEST_PILL[m.investStatus]}>{INVEST_LABEL[m.investStatus]}</Pill> : null}
        </div>
        {m.monthlyTarget == null ? (
          <p className={SUB}>
            Investido <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{fmtCurrency(m.invested)}</span> · sem Investimento mensal cadastrado
          </p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-2xl font-semibold tabular-nums ${m.investStatus ? INVEST_TEXT[m.investStatus] : ""}`}>{fmtCurrency(m.invested)}</span>
              <span className={SUB}>
                de {fmtCurrency(m.monthlyTarget)} · {Math.round((m.pctOfTarget ?? 0) * 100)}%
              </span>
            </p>
            <div className="relative h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className={`h-full rounded-full ${m.investStatus ? INVEST_BAR[m.investStatus] : "bg-zinc-400"}`} style={{ width: `${fill}%` }} />
              <div className="absolute -top-0.5 h-3 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${marker}%` }} title="Ideal até hoje" />
            </div>
            <p className={SUB}>
              Ideal até hoje: {fmtCurrency(m.idealUntilToday ?? 0)}
              {m.investDiff != null ? <span className={`ml-1 ${m.investStatus ? INVEST_TEXT[m.investStatus] : ""}`}>({fmtCurrencySigned(m.investDiff)})</span> : null}
            </p>
          </>
        )}
      </section>

      {/* 2 · CPA do mês × CPA ideal */}
      <section className="space-y-2 px-4 py-3">
        <p className={LABEL}>CPA do mês</p>
        <div className="flex items-stretch gap-3">
          <div className="flex flex-col justify-center">
            <p className={`text-2xl font-semibold tabular-nums ${m.cpaStatus ? CPA_TEXT[m.cpaStatus] : ""}`}>{m.cpa != null ? fmtCurrency(m.cpa) : "—"}</p>
            <p className="text-[11px] text-zinc-400">realizado</p>
          </div>
          <div className="rounded-lg bg-sky-100 px-3 py-1.5 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700">
            <p className="text-[10px] font-semibold uppercase tracking-wide">CPA ideal</p>
            <p className="text-2xl font-bold tabular-nums leading-tight">{cpaTarget != null ? fmtCurrency(cpaTarget) : "—"}</p>
          </div>
        </div>
        {m.cpaStatus && m.cpaDiff != null ? (
          <Pill cls={CPA_PILL[m.cpaStatus]} title={CPA_BANDS}>
            {m.cpaDiff > 0 ? `${fmtCurrency(m.cpaDiff)} acima do ideal` : m.cpaDiff < 0 ? `${fmtCurrency(Math.abs(m.cpaDiff))} abaixo do ideal` : "No ideal"}
          </Pill>
        ) : (
          <p className={SUB}>{cpaTarget == null ? "CPA ideal não cadastrado" : "Sem conversas no mês"}</p>
        )}
      </section>

      {/* 3 · Orçamento e ritmo */}
      <section className="space-y-2 px-4 py-3">
        <p className={LABEL}>Orçamento e ritmo (por dia)</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xl font-semibold tabular-nums">{fmtCurrency(insight.daily_budget)}</p>
            <p className="text-[11px] text-zinc-400">orçamento diário</p>
            {m.dailyDiff != null ? (
              <p className={`text-xs tabular-nums ${dailyCls}`}>{m.dailyDiff < 0 ? `${fmtCurrency(Math.abs(m.dailyDiff))} abaixo` : `${fmtCurrency(m.dailyDiff)} acima`}</p>
            ) : null}
          </div>
          <div title={ritmoTooltip(monthlyTarget, insight)}>
            <p className={`text-xl font-semibold tabular-nums ${rit != null ? dailyCls : ""}`}>{rit != null ? fmtCurrency(rit) : "—"}</p>
            <p className="text-[11px] text-zinc-400">ritmo · precisa investir</p>
          </div>
          <div title="Investimento mensal ÷ dias do mês">
            <p className="text-xl font-semibold tabular-nums">{avg != null ? fmtCurrency(avg) : "—"}</p>
            <p className="text-[11px] text-zinc-400">ritmo médio</p>
          </div>
        </div>
        {monthlyTarget == null ? <p className={SUB}>Sem Investimento mensal cadastrado — não dá pra calcular o ritmo.</p> : null}
      </section>

      {/* 4 · WhatsApp */}
      <section className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className={LABEL}>WhatsApp</p>
        <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{wa ? wa : <span className="font-normal text-zinc-500">não cadastrado</span>}</p>
      </section>
    </div>
  );
}
