"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount, AccountInsight } from "@/lib/meta/insights";
import { DATE_PRESETS, PRIORITY_OPTIONS, fmtCurrency, type PresetId } from "@/lib/format";
import { ContasExibidasDialog } from "@/components/painel/contas-exibidas-dialog";
import { InlineNumber } from "@/components/painel/inline-number";
import { ControleSaldo } from "@/components/painel/controle-saldo";

interface AccountBinding {
  ad_account_id: string;
  client_name: string | null;
  cpa_target: number | null;
  monthly_investment: number | null;
  daily_investment_target: number | null;
  priority: string | null;
}

interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  notes: string | null;
}

type BindingPatch = Partial<Omit<AccountBinding, "ad_account_id">>;
type PixPatch = Partial<Omit<PixRow, "ad_account_id">>;

export default function PainelPage() {
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [allAccounts, setAllAccounts] = useState<AdAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, AccountBinding>>({});
  const [pixAccounts, setPixAccounts] = useState<Record<string, PixRow>>({});
  const [insights, setInsights] = useState<Record<string, AccountInsight>>({});
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [preset, setPreset] = useState<PresetId>("last_7d");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Carrega seleção, contas do Meta e vínculos (cliente/metas) em paralelo.
  useEffect(() => {
    fetch("/api/selected-accounts")
      .then((r) => r.json())
      .then((d) => setSelectedIds(d.accountIds ?? []));

    fetch("/api/meta/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setAccountsError(d.error);
        else setAllAccounts(d.accounts ?? []);
      });

    fetch("/api/account-bindings")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, AccountBinding> = {};
        for (const b of d.bindings ?? []) map[b.ad_account_id] = b;
        setBindings(map);
      });

    fetch("/api/pix-accounts")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, PixRow> = {};
        for (const p of d.pixAccounts ?? []) map[p.ad_account_id] = p;
        setPixAccounts(map);
      });
  }, []);

  const selectedAccounts = useMemo(() => {
    if (!allAccounts || !selectedIds) return [];
    const set = new Set(selectedIds);
    return allAccounts.filter((a) => set.has(a.account_id));
  }, [allAccounts, selectedIds]);

  const loadInsights = useCallback(async () => {
    if (selectedAccounts.length === 0) {
      setInsights({});
      return;
    }
    setLoadingInsights(true);
    const res = await fetch("/api/meta/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: selectedAccounts.map((a) => a.account_id), datePreset: preset }),
    });
    const d = await res.json();
    setInsights(d.insights ?? {});
    setLoadingInsights(false);
  }, [selectedAccounts, preset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca os insights sempre que a seleção/período mudam
    void loadInsights();
  }, [loadInsights]);

  async function saveSelectedAccounts(ids: string[]) {
    setSelectedIds(ids);
    await fetch("/api/selected-accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: ids }),
    });
  }

  async function patchBinding(accountId: string, patch: BindingPatch) {
    const current = bindings[accountId] ?? { ad_account_id: accountId, client_name: null, cpa_target: null, monthly_investment: null, daily_investment_target: null, priority: null };
    const next = { ...current, ...patch };
    setBindings((prev) => ({ ...prev, [accountId]: next }));
    await fetch("/api/account-bindings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, ...patch }),
    });
  }

  async function patchPix(accountId: string, patch: PixPatch) {
    const current = pixAccounts[accountId] ?? { ad_account_id: accountId, payment_type: "prepaid", base_amount: null, notes: null };
    const next = { ...current, ...patch };
    setPixAccounts((prev) => ({ ...prev, [accountId]: next }));
    await fetch("/api/pix-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, ...patch }),
    });
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return selectedAccounts
      .map((acc) => {
        const binding = bindings[acc.account_id];
        const insight = insights[acc.account_id];
        return {
          acc,
          binding,
          insight,
          clientName: binding?.client_name || acc.name,
        };
      })
      .filter(
        (r) =>
          !q || r.clientName.toLowerCase().includes(q) || r.acc.name.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.insight?.spend ?? 0) - (a.insight?.spend ?? 0));
  }, [selectedAccounts, bindings, insights, search]);

  const totals = useMemo(() => {
    let spend = 0;
    let results = 0;
    for (const r of rows) {
      spend += r.insight?.spend ?? 0;
      results += r.insight?.results ?? 0;
    }
    return { spend, results, cpa: results > 0 ? spend / results : null };
  }, [rows]);

  if (selectedIds === null) {
    return <div className="p-8 text-sm text-zinc-500">Carregando…</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <header className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">Painel</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Visão geral das suas contas
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Mostrando {selectedAccounts.length} conta(s) selecionada(s).
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="h-9 shrink-0 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-950"
          >
            Contas exibidas{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </button>
        </div>
      </header>

      {accountsError ? (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {accountsError}
        </div>
      ) : selectedAccounts.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhuma conta selecionada.{" "}
          <button onClick={() => setPickerOpen(true)} className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Escolher contas
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Investido no período" value={fmtCurrency(totals.spend)} />
            <KpiCard label="Resultados" value={totals.results ? String(Math.round(totals.results)) : "—"} />
            <KpiCard label="CPA médio" value={fmtCurrency(totals.cpa)} />
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Acompanhamento de Resultados {loadingInsights ? "· atualizando…" : ""}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente ou conta…"
                  className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
                />
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
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Conta</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">CPA</th>
                    <th className="px-4 py-2 text-right font-medium">Meta CPA</th>
                    <th className="px-4 py-2 text-right font-medium">Valor usado</th>
                    <th className="px-4 py-2 text-right font-medium">Invest. mensal</th>
                    <th className="px-4 py-2 text-right font-medium">Invest. diário</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ acc, binding, insight }) => (
                    <tr key={acc.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2">
                        <input
                          defaultValue={binding?.client_name ?? ""}
                          placeholder={acc.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (binding?.client_name ?? "")) void patchBinding(acc.account_id, { client_name: v || null });
                          }}
                          className="w-36 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                        />
                      </td>
                      <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{acc.name}</td>
                      <td className="px-4 py-2">
                        <select
                          value={binding?.priority ?? ""}
                          onChange={(e) => void patchBinding(acc.account_id, { priority: e.target.value || null })}
                          className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                        >
                          <option value="">—</option>
                          {PRIORITY_OPTIONS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(insight?.cost_per_result)}</td>
                      <td className="px-4 py-2 text-right">
                        <InlineNumber
                          value={binding?.cpa_target ?? null}
                          onSave={(v) => patchBinding(acc.account_id, { cpa_target: v })}
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(insight?.spend ?? 0)}</td>
                      <td className="px-4 py-2 text-right">
                        <InlineNumber
                          value={binding?.monthly_investment ?? null}
                          onSave={(v) => patchBinding(acc.account_id, { monthly_investment: v })}
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(insight?.daily_budget ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ControleSaldo
            accounts={selectedAccounts}
            clientNames={Object.fromEntries(rows.map((r) => [r.acc.account_id, r.clientName]))}
            pixByAccount={pixAccounts}
            onPatch={patchPix}
          />
        </>
      )}

      <ContasExibidasDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedIds={selectedIds}
        onSave={saveSelectedAccounts}
      />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}
