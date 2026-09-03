"use client";

import { useEffect, useRef, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { PAYMENT_TYPES, fmtCurrency } from "@/lib/format";
import { billingHubUrl } from "@/lib/meta/ads-manager-link";
import { availableFunds } from "@/lib/meta/funds";
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
  onRefresh,
  refreshing,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  onPatch: (accountId: string, patch: Partial<Omit<PixRow, "ad_account_id">>) => Promise<void>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    prepaid: true,
    hybrid: true,
    postpaid: true,
    own_store: true,
  });

  // Puxa o tipo de pagamento (pré-paga/pós-paga) direto da Meta — só na
  // "criação" da conta aqui na tela, ou seja, só pra quem ainda não tem
  // Tipo salvo nenhum. Não faz parte da listagem de contas de sempre (que
  // roda a cada carregamento do Painel) de propósito: é uma consulta à
  // parte, feita uma única vez por conta — depois de salvo (puxado ou
  // escolhido à mão), nunca mais é chamada de novo nem sobrescrita
  // automaticamente, mesmo revisitando essa aba.
  const syncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newIds = accounts
      .map((a) => a.account_id)
      .filter((id) => !syncedRef.current.has(id) && !pixByAccount[id]?.payment_type);
    if (newIds.length === 0) return;
    newIds.forEach((id) => syncedRef.current.add(id));
    fetch("/api/meta/payment-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: newIds }),
    })
      .then((r) => r.json())
      .then((d) => {
        const isPrepay: Record<string, boolean | null> = d.isPrepay ?? {};
        for (const id of newIds) {
          const v = isPrepay[id];
          if (v == null) continue;
          void onPatch(id, { payment_type: v ? "prepaid" : "postpaid" });
        }
      })
      .catch(() => {
        // falha ao consultar a Meta — a conta fica sem tipo salvo, pra
        // escolha manual (tenta de novo só se essa aba for reaberta).
      });
  }, [accounts, pixByAccount, onPatch]);

  const groups: Record<string, AdAccount[]> = { prepaid: [], hybrid: [], postpaid: [], own_store: [] };
  for (const acc of accounts) {
    const type = pixByAccount[acc.account_id]?.payment_type || "prepaid";
    (groups[type] ?? groups.prepaid).push(acc);
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Controle de Saldo / PIX</h2>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {refreshing ? "Atualizando…" : "↻ Atualizar"}
        </button>
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
                          <th className="px-4 py-1.5 text-right font-medium">Saldo disponível</th>
                          <th className="px-4 py-1.5 text-right font-medium">Valor base</th>
                          <th className="px-4 py-1.5 text-right font-medium">Alertar quando &lt;</th>
                          <th className="px-4 py-1.5 font-medium">Observação</th>
                          <th className="px-4 py-1.5 font-medium">Tipo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((acc) => {
                          const pix = pixByAccount[acc.account_id];
                          const funds = availableFunds(acc);
                          return (
                            <tr key={acc.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                              <td className="px-4 py-2">{clientNames[acc.account_id] ?? acc.name}</td>
                              <td className="px-4 py-2">
                                <a
                                  href={billingHubUrl(acc.account_id, acc.business?.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Abrir Cobranças e Pagamentos"
                                  className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                                >
                                  {acc.name}
                                </a>
                              </td>
                              <td
                                className="px-4 py-2 text-right tabular-nums"
                                title={
                                  funds.fromCap
                                    ? "Teto de gasto − valor já gasto (fundo disponível)"
                                    : "Sem teto de gasto definido na Meta — mostrando o valor a pagar"
                                }
                              >
                                {fmtCurrency(funds.amount, acc.currency)}
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
