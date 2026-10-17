"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";

// Etapa 139: sub-área "Aumento programado" de Análise. Mostra o plano de aumento de investimento do dia (montado de
// madrugada, aplicado às 6h) e o histórico dos últimos dias. Dá pra refazer o plano, aplicar agora e tirar um conjunto do plano.

interface PlanRow {
  adset_id: string;
  ad_account_id: string;
  client_name: string | null;
  adset_name: string | null;
  cpa_target: number | null;
  cpa_3d: number | null;
  cpa_7d: number | null;
  conversations_3d: number | null;
  from_cents: number;
  step_cents: number;
  cap_cents: number;
  status: "planned" | "applied" | "skipped" | "failed";
  to_cents: number | null;
  note: string | null;
  plan_date: string;
}

const STATUS_LABEL: Record<PlanRow["status"], { text: string; cls: string }> = {
  planned: { text: "Planejado", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  applied: { text: "Aplicado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  skipped: { text: "Pulado", cls: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  failed: { text: "Falhou", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

function fmtDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

export function AumentoProgramado() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/budget-plan", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Falha ao carregar o plano.");
      setRows(j.rows ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/analysis/budget-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Falha.");
      if (body.action === "plan") setMsg(`Plano refeito: ${j.planned} conjunto(s) para aumentar.`);
      if (body.action === "apply")
        setMsg(`Aplicado: ${j.applied} · pulados: ${j.skipped} · falhas: ${j.failed}${j.remaining > 0 ? ` · restam ${j.remaining} (clique de novo)` : ""}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const todayDate = useMemo(() => rows.reduce((max, r) => (r.plan_date > max ? r.plan_date : max), ""), [rows]);
  const today = rows.filter((r) => r.plan_date === todayDate);
  const history = rows.filter((r) => r.plan_date !== todayDate);
  const pending = today.filter((r) => r.status === "planned");

  function renderRow(r: PlanRow, withActions: boolean) {
    const st = STATUS_LABEL[r.status];
    const final = r.status === "applied" && r.to_cents != null ? r.to_cents : Math.min(r.from_cents + r.step_cents, r.cap_cents);
    return (
      <li key={`${r.plan_date}-${r.adset_id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{r.adset_name ?? r.adset_id}</div>
          <div className="text-xs text-zinc-500">
            {r.client_name ?? r.ad_account_id} · CPA 3d {r.cpa_3d != null ? fmtCurrency(r.cpa_3d) : "—"} (meta {r.cpa_target != null ? fmtCurrency(r.cpa_target) : "—"})
            {r.cpa_7d != null ? ` · 7d ${fmtCurrency(r.cpa_7d)}` : ""} · {r.conversations_3d ?? 0} conversas
          </div>
          {r.note ? <div className="text-xs text-zinc-400">{r.note}</div> : null}
        </div>
        <div className="whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
          {fmtCurrency(r.from_cents / 100)} → <strong>{fmtCurrency(final / 100)}</strong>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.text}</span>
        {withActions && r.status === "planned" ? (
          <button
            onClick={() => void post({ action: "skip", adsetId: r.adset_id }, "skip")}
            disabled={busy != null}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Tirar do plano
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="space-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs text-zinc-500">
          Regra: CPA dos últimos 3 dias (sem hoje) até R$1 acima da meta (ou abaixo) → +R$10; até R$2 acima → +R$5. Teto de R$30 por dia
          (R$35 se o CPA de 7 dias estiver abaixo da meta). O plano é montado de madrugada e aplicado às 6h, em fila, conferindo na Meta na hora.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void post({ action: "plan" }, "plan")}
            disabled={busy != null}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {busy === "plan" ? "Calculando…" : "Refazer plano agora"}
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Aplicar agora o aumento em ${pending.length} conjunto(s)?`)) void post({ action: "apply" }, "apply");
            }}
            disabled={busy != null || pending.length === 0}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "apply" ? "Aplicando…" : `Aplicar agora (${pending.length})`}
          </button>
          <button
            onClick={() => void load()}
            disabled={busy != null || loading}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Atualizar
          </button>
        </div>
        {msg ? <p className="text-xs text-emerald-600">{msg}</p> : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhum plano ainda. Ele é montado de madrugada, ou clique em &quot;Refazer plano agora&quot;.</p>
      ) : (
        <>
          <h3 className="bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
            Plano de {todayDate ? fmtDay(todayDate) : "hoje"} ({today.length})
          </h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{today.map((r) => renderRow(r, true))}</ul>
          {history.length > 0 ? (
            <>
              <h3 className="bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">Dias anteriores</h3>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {history.map((r) => (
                  <Fragment2 key={`${r.plan_date}-${r.adset_id}`} day={fmtDay(r.plan_date)}>
                    {renderRow(r, false)}
                  </Fragment2>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// Prefixa o dia na linha do histórico sem quebrar a lista.
function Fragment2({ day, children }: { day: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute right-4 top-1 text-[10px] text-zinc-400">{day}</span>
      {children}
    </div>
  );
}
