"use client";

import { useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { PAYMENT_TYPES } from "@/lib/format";
import { billingHubUrl } from "@/lib/meta/ads-manager-link";
import { InlineNumber } from "@/components/painel/inline-number";

const WEEKDAYS = [
  { id: 0, label: "Domingo", short: "Dom" },
  { id: 1, label: "Segunda", short: "Seg" },
  { id: 2, label: "Terça", short: "Ter" },
  { id: 3, label: "Quarta", short: "Qua" },
  { id: 4, label: "Quinta", short: "Qui" },
  { id: 5, label: "Sexta", short: "Sex" },
  { id: 6, label: "Sábado", short: "Sáb" },
] as const;

export interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  notes: string | null;
  alert_threshold: number | null;
  friday_multiplier: number | null;
  manual_check_mode: string | null;
  manual_check_weekdays: number[] | null; // um ou mais dias (0-6), Etapa 67
  manual_check_interval_days: number | null;
  manual_check_repeat: boolean | null;
  manual_check_next_at: string | null;
}

export type PixPatch = Partial<Omit<PixRow, "ad_account_id">>;

function fmtDateBR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Etapa 63: quadro de configuração das rotinas/alertas por conta — a tela
// principal de Controle de Saldo agora só mostra quem está pendente, então
// esse modal é onde toda conta (inclusive as OK) pode ser configurada:
// tipo de pagamento, valor base, "Alertar quando <" e Observação (os 3 que
// já existiam, mantidos por pedido explícito), mais o multiplicador de
// sexta-feira e a verificação manual (um ou mais dias fixos da semana — mais
// de um por semana desde a Etapa 67 —, ou "daqui X dias", com
// Repetir/Pausar).
export function PersonalizarAlertasDialog({
  open,
  onClose,
  accounts,
  clientNames,
  pixByAccount,
  onPatch,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  onPatch: (accountId: string, patch: PixPatch) => Promise<void>;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    prepaid: true,
    hybrid: true,
    postpaid: true,
    own_store: true,
  });
  const [search, setSearch] = useState("");

  if (!open) return null;

  // Busca por nome do cliente, nome da conta na Meta, ou ID da conta —
  // ignora acento/maiúscula. Enquanto o usuário busca, todo grupo com
  // resultado abre sozinho, senão o filtro ficaria escondido atrás de um
  // grupo recolhido.
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filteredAccounts = query
    ? accounts.filter((acc) => {
        const haystack = `${clientNames[acc.account_id] ?? ""} ${acc.name} ${acc.account_id}`.toLocaleLowerCase("pt-BR");
        return haystack.includes(query);
      })
    : accounts;

  const groups: Record<string, AdAccount[]> = { prepaid: [], hybrid: [], postpaid: [], own_store: [] };
  for (const acc of filteredAccounts) {
    const type = pixByAccount[acc.account_id]?.payment_type || "prepaid";
    (groups[type] ?? groups.prepaid).push(acc);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Personalizar alertas — Controle de Saldo</h2>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            Fechar
          </button>
        </div>

        <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, conta ou ID…"
            className="w-full max-w-sm rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
        </div>

        <div className="flex-1 overflow-auto">
          {accounts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">Nenhuma conta selecionada.</p>
          ) : filteredAccounts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">Nenhuma conta encontrada para &quot;{search}&quot;.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {PAYMENT_TYPES.map(({ id, label }) => {
                const rows = groups[id] ?? [];
                if (rows.length === 0) return null;
                const isOpen = query ? true : openGroups[id];
                const isFridayEligible = id === "prepaid" || id === "hybrid";
                return (
                  <div key={id}>
                    <button
                      type="button"
                      onClick={() => setOpenGroups((s) => ({ ...s, [id]: !s[id] }))}
                      className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
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
                              <th className="px-4 py-1.5 font-medium">Conta</th>
                              <th className="px-4 py-1.5 font-medium">Tipo</th>
                              <th className="px-4 py-1.5 text-right font-medium">Valor base</th>
                              <th className="px-4 py-1.5 text-right font-medium">Alertar quando &lt;</th>
                              <th className="px-4 py-1.5 font-medium">Sexta (fim de semana)</th>
                              <th className="px-4 py-1.5 font-medium">Verificação manual</th>
                              <th className="px-4 py-1.5 font-medium">Observação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((acc) => {
                              const pix = pixByAccount[acc.account_id];
                              const mode = pix?.manual_check_mode ?? "";
                              return (
                                <tr key={acc.id} className="border-t border-zinc-100 align-top dark:border-zinc-800/60">
                                  <td className="px-4 py-2">
                                    <a
                                      href={billingHubUrl(acc.account_id, acc.business?.id)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Abrir Cobranças e Pagamentos"
                                      className="font-medium text-zinc-900 underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
                                    >
                                      {clientNames[acc.account_id] ?? acc.name}
                                    </a>
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
                                    {isFridayEligible ? (
                                      <select
                                        value={pix?.friday_multiplier ?? ""}
                                        onChange={(e) =>
                                          void onPatch(acc.account_id, {
                                            friday_multiplier: e.target.value ? Number(e.target.value) : null,
                                          })
                                        }
                                        className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                                      >
                                        <option value="">Desligado</option>
                                        <option value="2">2x o limite</option>
                                        <option value="3">3x o limite</option>
                                      </select>
                                    ) : (
                                      <span className="text-xs text-zinc-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <div className="flex flex-col gap-1">
                                      <select
                                        value={mode}
                                        onChange={(e) =>
                                          void onPatch(acc.account_id, {
                                            manual_check_mode: e.target.value || null,
                                          })
                                        }
                                        className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                                      >
                                        <option value="">Nenhuma</option>
                                        <option value="weekday">Dia fixo da semana</option>
                                        <option value="interval">Daqui X dias</option>
                                      </select>
                                      {mode === "weekday" ? (
                                        <div className="flex flex-wrap gap-1">
                                          {WEEKDAYS.map((w) => {
                                            const selected = (pix?.manual_check_weekdays ?? []).includes(w.id);
                                            return (
                                              <button
                                                key={w.id}
                                                type="button"
                                                title={w.label}
                                                onClick={() => {
                                                  const current = pix?.manual_check_weekdays ?? [];
                                                  const next = selected
                                                    ? current.filter((d) => d !== w.id)
                                                    : [...current, w.id].sort((a, b) => a - b);
                                                  void onPatch(acc.account_id, { manual_check_weekdays: next });
                                                }}
                                                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                                  selected
                                                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                                    : "border border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                                                }`}
                                              >
                                                {w.short}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                      {mode === "interval" ? (
                                        <div className="flex items-center gap-1 text-xs text-zinc-500">
                                          <span>a cada</span>
                                          <input
                                            type="number"
                                            min={1}
                                            defaultValue={pix?.manual_check_interval_days ?? ""}
                                            onBlur={(e) => {
                                              const v = e.target.value ? Number(e.target.value) : null;
                                              if (v !== (pix?.manual_check_interval_days ?? null)) {
                                                void onPatch(acc.account_id, { manual_check_interval_days: v });
                                              }
                                            }}
                                            className="w-14 rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
                                          />
                                          <span>dias</span>
                                        </div>
                                      ) : null}
                                      {mode ? (
                                        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                                          <input
                                            type="checkbox"
                                            checked={pix?.manual_check_repeat ?? true}
                                            onChange={(e) =>
                                              void onPatch(acc.account_id, { manual_check_repeat: e.target.checked })
                                            }
                                          />
                                          Repetir (desmarque pra pausar após verificar)
                                        </label>
                                      ) : null}
                                      {mode && pix?.manual_check_next_at ? (
                                        <span className="text-xs text-zinc-400">
                                          Próxima: {fmtDateBR(pix.manual_check_next_at)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2">
                                    <input
                                      defaultValue={pix?.notes ?? ""}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        if (v !== (pix?.notes ?? "")) void onPatch(acc.account_id, { notes: v || null });
                                      }}
                                      className="w-40 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                                    />
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
      </div>
    </div>
  );
}
