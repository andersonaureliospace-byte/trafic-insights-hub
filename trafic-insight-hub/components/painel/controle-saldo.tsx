"use client";

import { useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { PAYMENT_TYPES, fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { InlineNumber } from "@/components/painel/inline-number";

interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  notes: string | null;
  alert_threshold: number | null;
}

export function ControleSaldo({
  accounts,
  clientNames,
  pixByAccount,
  onPatch,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  onPatch: (accountId: string, patch: Partial<Omit<PixRow, "ad_account_id">>) => Promise<void>;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    prepaid: true,
    hybrid: true,
    postpaid: true,
  });

  const groups: Record<string, AdAccount[]> = { prepaid: [], hybrid: [], postpaid: [] };
  for (const acc of accounts) {
    const type = pixByAccount[acc.account_id]?.payment_type || "prepaid";
    (groups[type] ?? groups.prepaid).push(acc);
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Controle de Saldo / PIX</h2>
      </div>

      {accounts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta selecionada.</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {PAYMENT_TYPES.map(({ id, label }) => {
            const rows = groups[id] ?? [];
            if (rows.length === 0) return null;
            const isOpen = openGroups[id];
            return (
              <div key={id}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((s) => ({ ...s, [id]: !s[id] }))}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                >
                  <span className="text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    {rows.length}
                  </span>
                </button>
                {isOpen ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                          <th className="px-4 py-1.5 font-medium">Cliente</th>
                          <th className="px-4 py-1.5 font-medium">Conta</th>
                          <th className="px-4 py-1.5 text-right font-medium">Saldo</th>
                          <th className="px-4 py-1.5 text-right font-medium">Valor base</th>
                          <th className="px-4 py-1.5 text-right font-medium">Alertar quando &lt;</th>
                          <th className="px-4 py-1.5 font-medium">Observação</th>
                          <th className="px-4 py-1.5 font-medium">Tipo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((acc) => {
                          const pix = pixByAccount[acc.account_id];
                          return (
                            <tr key={acc.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                              <td className="px-4 py-2">{clientNames[acc.account_id] ?? acc.name}</td>
                              <td className="px-4 py-2">
                                <a
                                  href={adsManagerUrl(acc.account_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Abrir no Gerenciador de Anúncios"
                                  className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                                >
                                  {acc.name}
                                </a>
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                {fmtCurrency(Number(acc.balance) / 100, acc.currency)}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <InlineNumber
                                  value={pix?.base_amount ?? null}
                                  onSave={(v) => onPatch(acc.account_id, { base_amount: v })}
                                />
                              </td>
                              <td className="px-4 py-2 text-right">
                                <InlineNumber
                                  value={pix?.alert_threshold ?? null}
                                  onSave={(v) => onPatch(acc.account_id, { alert_threshold: v })}
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  defaultValue={pix?.notes ?? ""}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v !== (pix?.notes ?? "")) void onPatch(acc.account_id, { notes: v || null });
                                  }}
                                  className="w-48 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <select
                                  value={pix?.payment_type ?? "prepaid"}
                                  onChange={(e) => void onPatch(acc.account_id, { payment_type: e.target.value })}
                                  className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                                >
                                  {PAYMENT_TYPES.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
