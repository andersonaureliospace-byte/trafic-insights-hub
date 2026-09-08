"use client";

import { useEffect, useState } from "react";

interface LocationIssue {
  adset_id: string;
  adset_name: string | null;
  campaign_name: string | null;
  reasons: string[];
  paused?: boolean;
  pause_error?: string | null;
}

interface LocationRow {
  ad_account_id: string;
  account_name: string;
  status: "correct" | "incorrect";
  issues: LocationIssue[];
  checked_at: string | null;
}

export function LocationAudit() {
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(true);

  async function load() {
    const res = await fetch("/api/audit/location");
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setRows(d.rows ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial do status de auditoria de localização
    void load();
  }, []);

  async function handleRun() {
    if (!confirm("A verificação pausa automaticamente os conjuntos com configuração incorreta. Deseja continuar?")) {
      return;
    }
    setRunning(true);
    const res = await fetch("/api/audit/location", { method: "POST" });
    const d = await res.json();
    setRunning(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setRows(d.rows ?? []);
    const msg = `Verificação concluída · ${d.pausedCount} conjunto(s) pausado(s)${d.failedCount > 0 ? ` · ${d.failedCount} falha(s)` : ""}`;
    alert(msg);
  }

  const sorted = [...(rows ?? [])].sort((a, b) => {
    const rank = (s: string) => (s === "incorrect" ? 0 : 1);
    return rank(a.status) - rank(b.status) || a.account_name.localeCompare(b.account_name, "pt-BR");
  });
  const incorrect = sorted.filter((r) => r.status === "incorrect").length;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-start gap-2 text-left">
          <span className="mt-0.5 text-zinc-400">{open ? "▾" : "▸"}</span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Localização dos conjuntos</h2>
            {open ? (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Marcado como <strong>Incorreto</strong> quando um conjunto ativo está com localização Brasil (país
                inteiro) ou com a expansão de público ligada.
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {sorted.length} conta(s) · {incorrect} incorreta(s)
              </p>
            )}
          </div>
        </button>
        <button
          onClick={() => void handleRun()}
          disabled={running}
          className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Verificando…" : "Verificar agora"}
        </button>
      </div>

      {open ? (
        <div>
          {error ? (
            <p className="px-4 py-6 text-sm text-red-600">{error}</p>
          ) : !rows ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : sorted.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              Nenhuma conta vinculada (defina o &quot;Grupo WhatsApp&quot; ou o Cliente das contas no Painel).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                    <th className="w-6 px-4 py-2"></th>
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Conjuntos com problema</th>
                    <th className="px-4 py-2 font-medium">Última verificação</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const isOpen = !!expanded[r.ad_account_id];
                    const canExpand = r.issues.length > 0;
                    return (
                      <>
                        <tr
                          key={r.ad_account_id}
                          onClick={() => canExpand && setExpanded((s) => ({ ...s, [r.ad_account_id]: !s[r.ad_account_id] }))}
                          className={`border-t border-zinc-100 dark:border-zinc-800/60 ${canExpand ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" : ""}`}
                        >
                          <td className="px-4 py-2 text-zinc-400">{canExpand ? (isOpen ? "▾" : "▸") : null}</td>
                          <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{r.account_name}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                r.status === "incorrect"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              }`}
                            >
                              {r.status === "incorrect" ? "Incorreto" : "Correto"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{r.issues.length || "—"}</td>
                          <td className="px-4 py-2 text-xs text-zinc-400">
                            {r.checked_at ? new Date(r.checked_at).toLocaleString("pt-BR") : "—"}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr key={`${r.ad_account_id}-detail`} className="bg-zinc-50 dark:bg-zinc-800/30">
                            <td />
                            <td colSpan={4} className="px-4 py-3">
                              <div className="space-y-2">
                                {r.issues.map((i) => (
                                  <div key={i.adset_id} className="text-xs">
                                    <div className="flex flex-wrap items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                                      <span>{i.adset_name}</span>
                                      {i.campaign_name ? <span className="text-zinc-400">· {i.campaign_name}</span> : null}
                                      {i.paused ? (
                                        <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                          Pausado
                                        </span>
                                      ) : i.paused === false ? (
                                        <span
                                          className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300"
                                          title={i.pause_error ?? undefined}
                                        >
                                          Falha ao pausar
                                        </span>
                                      ) : null}
                                    </div>
                                    <ul className="ml-4 list-disc text-zinc-500 dark:text-zinc-400">
                                      {i.reasons.map((reason) => (
                                        <li key={reason}>{reason}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
