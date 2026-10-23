"use client";

import { fmtCurrency, fmtCurrencySigned } from "@/lib/format";
import { ritmoColorClass } from "@/lib/meta/ritmo";
import {
  SPEED_CPA_ACCEPTABLE,
  SPEED_CPA_LABEL,
  SPEED_INVEST_LABEL,
  computeSpeed,
  speedBudgetTooltip,
  speedOkText,
  type SpeedCpa,
  type SpeedInvest,
} from "@/lib/meta/speed";
import type { AccountInsight } from "@/lib/meta/insights";

// Modo Foco — quadro "Acompanhamento de metas" de UMA conta, em 4 blocos (rótulo pequeno → número grande → uma linha de apoio):
// Investimento do mês, CPA do mês × CPA ideal, Orçamento (atual × Gastar hoje × Gastar amanhã). O WhatsApp agora fica na linha de cima da página (ao lado do Gerenciador).
// Etapa 185: status e contas iguais aos da Speed (lib/meta/speed.ts), com o dado ao vivo. Só mostra; quem busca é a página.

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-zinc-400";
const SUB = "text-xs text-zinc-500 dark:text-zinc-400";

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
const CPA_PILL: Record<SpeedCpa, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  acceptable: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const CPA_BANDS = `Regra da Speed — OK: no CPA ideal ou abaixo · Aceitável: até ${fmtCurrency(SPEED_CPA_ACCEPTABLE)} acima · Acima: mais que isso. CPA = investimento total ÷ conversas.`;
const INVEST_RULE =
  "Regra da Speed: compara o gasto ATÉ ONTEM com o ideal ATÉ HOJE (meta ÷ dias do mês × dia de hoje), com 2% de folga pros dois lados.";

function Pill({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

const pctTxt = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function FocoMetas({
  insight,
  untilYesterday,
  cpaTarget,
  monthlyTarget,
}: {
  insight: AccountInsight | null;
  untilYesterday: number | null;
  cpaTarget: number | null;
  monthlyTarget: number | null;
}) {
  if (!insight || insight.insights_failed) {
    return (
      <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
        {insight?.insights_failed ? `A Meta não devolveu o gasto do mês desta conta${insight.insights_error ? ` (${insight.insights_error})` : ""}. Clique em Atualizar.` : "Carregando…"}
      </p>
    );
  }
  const s = computeSpeed({
    monthlyTarget,
    spentSoFar: insight.spend,
    spentUntilYesterday: untilYesterday,
    cpa: insight.cost_per_result,
    cpaTarget,
    dailyBudget: insight.daily_budget,
  });
  const hasTarget = s.normal != null && monthlyTarget != null;
  const pctOfTarget = hasTarget ? insight.spend / monthlyTarget : null;
  const fill = pctOfTarget != null ? Math.min(pctOfTarget, 1) * 100 : 0;
  const marker = Math.min((s.day / s.daysInMonth) * 100, 100);
  const tip = speedBudgetTooltip(s, monthlyTarget);
  const budgetDiff = s.gastarAmanha != null ? insight.daily_budget - s.gastarAmanha : null;
  const budgetCls = s.gastarAmanha != null ? ritmoColorClass(s.gastarAmanha, insight.daily_budget) : "";
  const okTxt = speedOkText(s);

  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {/* 1 · Investimento do mês */}
      <section className="space-y-1.5 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>Investimento do mês</p>
          {s.investStatus ? (
            <Pill cls={INVEST_PILL[s.investStatus]} title={INVEST_RULE}>
              Speed: {SPEED_INVEST_LABEL[s.investStatus]}
            </Pill>
          ) : hasTarget ? (
            <span className={SUB} title="Sem o gasto até ontem (o backup diário não respondeu) — clique em Atualizar.">
              status indisponível
            </span>
          ) : null}
        </div>
        {!hasTarget ? (
          <p className={SUB}>
            Investido <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{fmtCurrency(insight.spend)}</span> · sem Investimento mensal cadastrado
          </p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2" title="Gasto do dia 01 até agora, contando hoje">
              <span className={`text-xl font-semibold tabular-nums ${s.investStatus ? INVEST_TEXT[s.investStatus] : ""}`}>{fmtCurrency(insight.spend)}</span>
              <span className={SUB}>
                de {fmtCurrency(monthlyTarget)} · {Math.round((pctOfTarget ?? 0) * 100)}%
              </span>
            </p>
            <div className="relative h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className={`h-full rounded-full ${s.investStatus ? INVEST_BAR[s.investStatus] : "bg-zinc-400"}`} style={{ width: `${fill}%` }} />
              <div className="absolute -top-0.5 h-2.5 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${marker}%` }} title="Ideal até hoje" />
            </div>
            <p className={SUB} title={INVEST_RULE}>
              Até ontem: {untilYesterday != null ? fmtCurrency(untilYesterday) : "—"} · ideal até hoje {fmtCurrency(s.idealToday ?? 0)}
              {s.speedDiff != null && s.speedDiffPct != null ? (
                <span className={`ml-1 ${s.investStatus ? INVEST_TEXT[s.investStatus] : ""}`}>
                  ({fmtCurrencySigned(s.speedDiff)} · {pctTxt(s.speedDiffPct)})
                </span>
              ) : null}
            </p>
          </>
        )}
      </section>

      {/* 2 · CPA do mês (esquerda) × CPA ideal (direita), na mesma altura */}
      <section className="space-y-1.5 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>CPA do mês</p>
          {s.cpaStatus && s.cpaDiff != null ? (
            <Pill cls={CPA_PILL[s.cpaStatus]} title={CPA_BANDS}>
              Speed: {SPEED_CPA_LABEL[s.cpaStatus]}
              {s.cpaDiff > 0.004 ? ` · +${fmtCurrency(s.cpaDiff)}` : s.cpaDiff < -0.004 ? ` · −${fmtCurrency(Math.abs(s.cpaDiff))}` : ""}
            </Pill>
          ) : (
            <span className={SUB}>{cpaTarget == null ? "CPA ideal não cadastrado" : "Sem conversas no mês"}</span>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div title="Investimento total do mês ÷ conversas (regra da Speed), contando hoje">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Realizado</p>
            <p className={`text-xl font-semibold leading-tight tabular-nums ${s.cpaStatus ? CPA_TEXT[s.cpaStatus] : ""}`}>{s.cpa != null ? fmtCurrency(s.cpa) : "—"}</p>
          </div>
          <div className="rounded-lg bg-sky-100 px-3 py-1 text-right text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700">
            <p className="text-[10px] font-semibold uppercase tracking-wide">CPA ideal</p>
            <p className="text-xl font-bold leading-tight tabular-nums">{cpaTarget != null ? fmtCurrency(cpaTarget) : "—"}</p>
          </div>
        </div>
      </section>

      {/* 3 · Orçamento: atual × Gastar hoje × Gastar amanhã */}
      <section className="space-y-1.5 px-3 py-2" title={tip}>
        <p className={LABEL}>Orçamento (por dia)</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-lg font-semibold leading-tight tabular-nums">{fmtCurrency(insight.daily_budget)}</p>
            <p className="text-[11px] text-zinc-400">
              atual
              {budgetDiff != null && Math.abs(budgetDiff) >= 0.01 ? (
                <span className={`ml-1 tabular-nums ${budgetCls}`}>({budgetDiff < 0 ? "−" : "+"}{fmtCurrency(Math.abs(budgetDiff))})</span>
              ) : null}
            </p>
          </div>
          <div>
            {/* Etapa 193: o valor do dia (ritmo + atraso, no teto); embaixo, quanto ainda falta gastar hoje. */}
            <p className="text-lg font-semibold leading-tight tabular-nums">{s.metaHoje != null ? fmtCurrency(s.metaHoje) : "—"}</p>
            <p className="text-[11px] text-zinc-400">
              gastar hoje{s.gastarHoje != null ? <span className="tabular-nums"> · falta {fmtCurrency(s.gastarHoje)}</span> : null}
            </p>
          </div>
          <div>
            <p className={`text-lg font-semibold leading-tight tabular-nums ${budgetCls}`}>{s.gastarAmanha != null ? fmtCurrency(s.gastarAmanha) : "—"}</p>
            <p className="text-[11px] text-zinc-400">gastar amanhã</p>
          </div>
        </div>
        {!hasTarget ? (
          <p className={SUB}>Sem Investimento mensal cadastrado — não dá pra calcular.</p>
        ) : (
          <p className={SUB}>
            Ritmo médio {fmtCurrency(s.normal ?? 0)} · teto {fmtCurrency(s.cap ?? 0)}
            {okTxt ? <span className={`ml-1 ${s.okInDays === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>· {okTxt}</span> : null}
          </p>
        )}
      </section>
    </div>
  );
}
