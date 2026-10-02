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
  // Etapa 79: "Tipo de conta" — Pix/Híbrida/Boleto/Cartão (ver
  // lib/format.ts PAYMENT_TYPES e supabase/migrations/0024_*). null = ainda
  // sem tipo definido, preenchido manualmente aqui na aba Configurações.
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
  // Etapa 73: destino do envio de PIX por WhatsApp (botão "Enviar Pix" em
  // Controle de Saldo) — "grupo" reaproveita o grupo já vinculado ao cliente
  // (Painel → Clientes); "numero" manda direto pra um número fixo. Raramente
  // muda, por isso configurado aqui junto do resto.
  pix_target_type: "grupo" | "numero" | null;
  pix_target_number: string | null;
  // Etapa 81: "Saldo por fundos" (pagamentos menos cobranças, rastreado a
  // partir de um saldo inicial informado manualmente) — independente do
  // Tipo de conta, liga conta por conta pra qualquer uma cujo saldo real
  // não bata com o "a pagar"/"disponível" padrão (ex.: conta Boleto que na
  // prática também recebe pagamento manual). Ver supabase/migrations/0025_*
  // e lib/meta/funds-balance.ts.
  funds_balance_enabled: boolean | null;
  funds_balance_amount: number | null;
  funds_balance_currency: string | null;
  funds_balance_watermark: string | null;
  funds_balance_updated_at: string | null;
}

export type PixPatch = Partial<Omit<PixRow, "ad_account_id">>;

function fmtDateBR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Etapa 63: quadro de configuração das rotinas/alertas por conta. Etapa 79:
// deixou de ser um modal avulso ("Personalizar alertas") e virou a própria
// sub-aba "Configurações" de Controle de Saldo — é aqui que toda conta
// (inclusive quem ainda não tem Tipo de conta nenhum) é classificada em
// Pix/Híbrida/Boleto/Cartão, além do valor base, "Alertar quando <",
// Observação, sexta-feira e verificação manual.
export function PersonalizarAlertasPanel({
  accounts,
  clientNames,
  pixByAccount,
  onPatch,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  onPatch: (accountId: string, patch: PixPatch) => Promise<void>;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    unclassified: true,
    pix: true,
    hybrid: true,
    boleto: true,
    card: true,
  });
  const [search, setSearch] = useState("");

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

  // "unclassified" (sem Tipo de conta ainda) sempre primeiro — é o grupo que
  // mais precisa de atenção logo após a Etapa 79 (todo mundo começa sem
  // tipo definido, ver supabase/migrations/0024_*).
  const groups: Record<string, AdAccount[]> = { unclassified: [], pix: [], hybrid: [], boleto: [], card: [] };
  for (const acc of filteredAccounts) {
    const type = pixByAccount[acc.account_id]?.payment_type;
    (type && groups[type] ? groups[type] : groups.unclassified).push(acc);
  }

  const sections = [{ id: "unclassified", label: "Sem tipo definido" }, ...PAYMENT_TYPES];

  return (
    <div>
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, conta ou ID…"
          className="w-full max-w-sm rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
        />
      </div>

      {accounts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta selecionada.</p>
      ) : filteredAccounts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta encontrada para &quot;{search}&quot;.</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sections.map(({ id, label }) => {
            const rows = groups[id] ?? [];
            if (rows.length === 0) return null;
            const isOpen = query ? true : openGroups[id];
            const isFridayEligible = id === "pix" || id === "hybrid";
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
                          <th className="px-4 py-1.5 font-medium">Conta</th>
                          <th className="px-4 py-1.5 font-medium">Tipo de conta</th>
                          <th className="px-4 py-1.5 font-medium">Destino do Pix</th>
                          <th className="px-4 py-1.5 text-right font-medium">Valor base</th>
                          <th className="px-4 py-1.5 text-right font-medium">Alertar quando &lt;</th>
                          <th className="px-4 py-1.5 font-medium">Sexta (fim de semana)</th>
                          <th className="px-4 py-1.5 font-medium">Verificação manual</th>
                          <th className="px-4 py-1.5 font-medium">Observação</th>
                          <th
                            className="px-4 py-1.5 font-medium"
                            title="Saldo rastreado à parte, independente do Tipo de conta: começa de um valor que você informa (o saldo real, visto no Ads Manager) e a partir daí soma pagamento manual/PIX e subtrai cobrança — útil quando o Tipo de conta não reflete sozinho como a Meta cobra essa conta."
                          >
                            Saldo por fundos
                          </th>
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
                                  value={pix?.payment_type ?? ""}
                                  onChange={(e) =>
                                    void onPatch(acc.account_id, { payment_type: e.target.value || null })
                                  }
                                  className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                                >
                                  <option value="">Sem tipo definido</option>
                                  {PAYMENT_TYPES.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex flex-col gap-1">
                                  <select
                                    value={pix?.pix_target_type ?? "grupo"}
                                    onChange={(e) =>
                                      void onPatch(acc.account_id, {
                                        pix_target_type: e.target.value as "grupo" | "numero",
                                      })
                                    }
                                    className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                                  >
                                    <option value="grupo">Grupo do cliente</option>
                                    <option value="numero">Número específico</option>
                                  </select>
                                  {pix?.pix_target_type === "numero" ? (
                                    <input
                                      defaultValue={pix?.pix_target_number ?? ""}
                                      placeholder="Ex: 5547999998888"
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        if (v !== (pix?.pix_target_number ?? "")) {
                                          void onPatch(acc.account_id, { pix_target_number: v || null });
                                        }
                                      }}
                                      className="w-32 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
                                    />
                                  ) : null}
                                </div>
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
                              <td className="px-4 py-2">
                                <div className="flex flex-col gap-1">
                                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                                    <input
                                      type="checkbox"
                                      checked={pix?.funds_balance_enabled ?? false}
                                      onChange={(e) =>
                                        void onPatch(acc.account_id, { funds_balance_enabled: e.target.checked })
                                      }
                                    />
                                    Ativar
                                  </label>
                                  {pix?.funds_balance_enabled ? (
                                    <>
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-zinc-400">Saldo atual</span>
                                        <InlineNumber
                                          value={pix?.funds_balance_amount ?? null}
                                          width="w-20"
                                          onSave={(v) =>
                                            onPatch(acc.account_id, {
                                              funds_balance_amount: v,
                                              funds_balance_watermark: new Date().toISOString(),
                                            })
                                          }
                                        />
                                      </div>
                                      <span className="text-[11px] text-zinc-400">
                                        {pix?.funds_balance_updated_at
                                          ? `Atualizado em ${new Date(pix.funds_balance_updated_at).toLocaleString("pt-BR")}`
                                          : "Defina o saldo atual pra começar"}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
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
