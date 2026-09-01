"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import type { BreakdownLevel, BreakdownRow } from "@/lib/meta/breakdown";
import { DATE_PRESETS, fmtCurrency, type PresetId } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

const LEVELS: { id: BreakdownLevel; label: string }[] = [
  { id: "campaign", label: "Campanhas" },
  { id: "adset", label: "Conjuntos" },
  { id: "ad", label: "Anúncios" },
];

export function VisaoGeral({ accounts, preset: painelPreset }: { accounts: AdAccount[]; preset: PresetId }) {
  const [accountId, setAccountId] = useState(accounts[0]?.account_id ?? "");
  const [level, setLevel] = useState<BreakdownLevel>("campaign");
  const [preset, setPreset] = useState<PresetId>(painelPreset);
  const [rows, setRows] = useState<BreakdownRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && accounts[0]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- escolhe a primeira conta assim que a lista carrega
      setAccountId(accounts[0].account_id);
    }
  }, [accounts, accountId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/meta/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, datePreset: preset, level }),
    });
    const d = await res.json();
    setLoading(false);
    if (d.error) {
      setError(d.error);
      setRows(null);
      return;
    }
    setRows(d.rows ?? []);
  }, [accountId, preset, level]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o breakdown ao trocar conta/nível/período
    void load();
  }, [load]);

  async function toggleStatus(row: BreakdownRow) {
    const next = row.status?.toUpperCase() === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setTogglingId(row.id);
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: row.id, type: level }], status: next }),
    });
    const d = await res.json();
    setTogglingId(null);
    const result = d.results?.[0];
    if (!result?.ok) {
      alert(result?.error ?? "Não foi possível atualizar o status.");
      return;
    }
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)) : prev));
  }

  if (accounts.length === 0) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Visão Geral</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-8 max-w-[220px] rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
          >
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetId)}
            className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {accountId ? (
            <a
              href={adsManagerUrl(accountId)}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium leading-8 text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Abrir no Facebook ↗
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 px-4 pt-2 dark:border-zinc-800">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLevel(l.id)}
            className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
              level === l.id
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : loading && !rows ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nada com atividade nesse período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Gasto</th>
                <th className="px-4 py-2 text-right font-medium">Resultados</th>
                <th className="px-4 py-2 text-right font-medium">CPA</th>
                <th className="px-4 py-2 text-right font-medium">Orç. diário</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const active = row.status?.toUpperCase() === "ACTIVE";
                return (
                  <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                    <td className="max-w-[280px] truncate px-4 py-2" title={row.name}>
                      {row.name}
                      {row.page_access_ok === false ? (
                        <span
                          className="ml-1.5 text-amber-600"
                          title="Sem confirmação de acesso à Página deste anúncio"
                        >
                          ⚠
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {active ? "Ativo" : row.status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(row.spend)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.results ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(row.cost_per_result)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(row.daily_budget)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => toggleStatus(row)}
                        disabled={togglingId === row.id}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                      >
                        {togglingId === row.id ? "…" : active ? "Pausar" : "Ativar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
