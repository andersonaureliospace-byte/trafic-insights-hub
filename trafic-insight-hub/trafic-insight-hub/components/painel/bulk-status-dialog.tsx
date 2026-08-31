"use client";

import { useState } from "react";
import { PRIORITY_OPTIONS, isInauguracao } from "@/lib/format";

interface Candidate {
  accountId: string;
  clientName: string;
  cpaTarget: number | null;
  priority: string | null;
}

interface ResultRow {
  accountId: string;
  clientName: string;
  outcome: "updated" | "unchanged" | "skipped";
  from?: string | null;
  to?: string;
  reason?: string;
}

function classify(cpa: number, target: number): string {
  const diff = cpa - target;
  if (diff < 0) return "baixa";
  if (diff <= 2) return "media";
  if (diff <= 3) return "alta";
  return "critica";
}

function labelFor(id?: string | null) {
  return PRIORITY_OPTIONS.find((p) => p.id === id)?.label ?? "—";
}

export function BulkStatusDialog({
  open,
  onClose,
  candidates,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  candidates: Candidate[];
  onApply: (accountId: string, priority: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [results, setResults] = useState<ResultRow[]>([]);

  if (!open) return null;

  async function run() {
    setPhase("running");
    const res: ResultRow[] = [];
    for (const c of candidates) {
      if (isInauguracao(c.priority)) {
        res.push({ accountId: c.accountId, clientName: c.clientName, outcome: "skipped", reason: "Em inauguração" });
        continue;
      }
      if (!c.cpaTarget) {
        res.push({ accountId: c.accountId, clientName: c.clientName, outcome: "skipped", reason: "Sem meta de CPA" });
        continue;
      }
      try {
        const dailyRes = await fetch("/api/meta/daily-cpa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: [c.accountId], days: 3 }),
        });
        const d = await dailyRes.json();
        const points = (d.daily?.[c.accountId] ?? []) as { spend: number; results: number }[];
        const spend = points.reduce((s, p) => s + p.spend, 0);
        const totalResults = points.reduce((s, p) => s + p.results, 0);
        if (spend <= 0) {
          res.push({
            accountId: c.accountId,
            clientName: c.clientName,
            outcome: "skipped",
            reason: "Sem gasto nos últimos 3 dias",
          });
          continue;
        }
        const cpa = totalResults > 0 ? spend / totalResults : spend;
        const next = classify(cpa, c.cpaTarget);
        if (next === c.priority) {
          res.push({ accountId: c.accountId, clientName: c.clientName, outcome: "unchanged", to: next });
          continue;
        }
        await onApply(c.accountId, next);
        res.push({ accountId: c.accountId, clientName: c.clientName, outcome: "updated", from: c.priority, to: next });
      } catch (e) {
        res.push({
          accountId: c.accountId,
          clientName: c.clientName,
          outcome: "skipped",
          reason: (e as Error).message || "Erro ao calcular",
        });
      }
    }
    setResults(res);
    setPhase("done");
  }

  function handleClose() {
    setPhase("confirm");
    setResults([]);
    onClose();
  }

  const updated = results.filter((r) => r.outcome === "updated").length;
  const unchanged = results.filter((r) => r.outcome === "unchanged").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={handleClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Atualizar status em massa</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {phase === "confirm" ? (
            <div className="space-y-3 text-zinc-600 dark:text-zinc-300">
              <p>
                Serão avaliadas <strong>{candidates.length}</strong> conta(s) exibida(s), usando o CPA dos últimos 3
                dias (ontem, anteontem e trás-anteontem):
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Abaixo do CPA meta → <strong>Baixa</strong>
                </li>
                <li>
                  Até +R$ 2 acima da meta → <strong>Média</strong>
                </li>
                <li>
                  Até +R$ 3 acima da meta → <strong>Alta</strong>
                </li>
                <li>
                  Acima de R$ 3 acima da meta → <strong>Crítica</strong>
                </li>
              </ul>
              <p className="text-xs text-zinc-500">
                Contas em inauguração, sem meta de CPA cadastrada, ou sem gasto nos últimos 3 dias não são alteradas.
              </p>
            </div>
          ) : phase === "running" ? (
            <p className="py-8 text-center text-zinc-500">Calculando e atualizando…</p>
          ) : (
            <div className="space-y-3">
              <p className="text-zinc-600 dark:text-zinc-300">
                <strong>{updated}</strong> atualizada(s) · <strong>{unchanged}</strong> já correta(s) ·{" "}
                <strong>{skipped}</strong> pulada(s)
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-xs">
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.accountId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                        <td className="px-3 py-1.5">{r.clientName}</td>
                        <td className="px-3 py-1.5 text-zinc-500">
                          {r.outcome === "updated"
                            ? `${labelFor(r.from)} → ${labelFor(r.to)}`
                            : r.outcome === "unchanged"
                              ? `Já em ${labelFor(r.to)}`
                              : r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {phase === "confirm" ? (
            <>
              <button
                onClick={handleClose}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
              >
                Cancelar
              </button>
              <button
                onClick={run}
                disabled={candidates.length === 0}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Avaliar e atualizar
              </button>
            </>
          ) : phase === "done" ? (
            <button
              onClick={handleClose}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Fechar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
