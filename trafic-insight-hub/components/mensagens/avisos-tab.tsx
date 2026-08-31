"use client";

import { useEffect, useState } from "react";
import { fmtCurrency } from "@/lib/format";

interface BalanceStatus {
  ad_account_id: string;
  client_name: string;
  balance: number;
  currency: string;
  threshold: number;
  low: boolean;
  alerted: boolean;
}

export function AvisosTab() {
  const [statuses, setStatuses] = useState<BalanceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function load() {
    const res = await fetch("/api/alerts/balance");
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setStatuses(d.statuses ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial do status de saldo
    void load();
  }, []);

  async function handleCheck() {
    setChecking(true);
    const res = await fetch("/api/alerts/balance", { method: "POST" });
    const d = await res.json();
    setChecking(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setStatuses(d.statuses ?? []);
    const alerted = (d.statuses ?? []).filter((s: BalanceStatus) => s.alerted).length;
    alert(alerted > 0 ? `Aviso enviado pro grupo — ${alerted} conta(s) com saldo baixo.` : "Nenhuma conta com saldo baixo agora.");
  }

  const low = (statuses ?? []).filter((s) => s.low);
  const ok = (statuses ?? []).filter((s) => !s.low);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Considera contas pré-paga/híbrida com um limite definido (campo &quot;Alertar quando &lt;&quot; no
        Controle de Saldo/PIX do Painel — se ficar em branco, usa 20% do Valor base). O aviso vai pro
        grupo configurado em Configurações → WhatsApp.
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Saldo das contas</h3>
          <button
            onClick={() => void handleCheck()}
            disabled={checking}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {checking ? "Verificando…" : "Verificar agora"}
          </button>
        </div>

        {error ? (
          <p className="px-4 py-6 text-sm text-red-600">{error}</p>
        ) : !statuses ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
        ) : statuses.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">
            Nenhuma conta pré-paga/híbrida com limite definido ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 text-right font-medium">Limite</th>
                </tr>
              </thead>
              <tbody>
                {[...low, ...ok].map((s) => (
                  <tr key={s.ad_account_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.client_name}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.low
                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        }`}
                      >
                        {s.low ? "Saldo baixo" : "OK"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.balance, s.currency)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.threshold, s.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
