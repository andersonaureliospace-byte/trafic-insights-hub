"use client";

import { useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { InlineNumber } from "@/components/painel/inline-number";
import { WhatsappGroupCell } from "@/components/painel/whatsapp-group-cell";

export interface ClienteBinding {
  client_name: string | null;
  cpa_target: number | null;
  monthly_investment: number | null;
  meta_leads: number | null;
  whatsapp_contact: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
  address: string | null;
}

type ClienteBindingPatch = Partial<ClienteBinding>;

// Ficha de clientes — tudo que é preenchido à mão (CPA ideal, Investimento
// mensal, Meta de leads, WhatsApp de contato, Endereço) numa tela só, com o
// nome/ID da conta ao lado pra referência (ex.: montar a planilha da
// análise IVS sem ter que caçar ID conta por conta).
export function ClientesTab({
  accounts,
  bindings,
  onPatch,
  onRefresh,
  refreshing,
}: {
  accounts: AdAccount[];
  bindings: Record<string, ClienteBinding | undefined>;
  onPatch: (accountId: string, patch: ClienteBindingPatch) => Promise<void>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyId(accountId: string) {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopiedId(accountId);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // clipboard indisponível — sem tratamento especial
    }
  }

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Clientes</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Dados preenchidos manualmente — CPA ideal e Investimento mensal são os mesmos usados no resto do Painel.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {refreshing ? "Atualizando…" : "↻ Atualizar"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Nome do cliente</th>
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-4 py-2 font-medium">ID da conta</th>
              <th className="px-4 py-2 text-right font-medium">CPA ideal</th>
              <th className="px-4 py-2 text-right font-medium">Invest. mensal</th>
              <th className="px-4 py-2 text-right font-medium">Meta de leads</th>
              <th className="px-4 py-2 font-medium">WhatsApp</th>
              <th className="px-4 py-2 font-medium">Grupo WhatsApp</th>
              <th className="px-4 py-2 font-medium">Endereço</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => {
              const binding = bindings[acc.account_id];
              return (
                <tr key={acc.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2">
                    <input
                      defaultValue={binding?.client_name ?? ""}
                      placeholder={acc.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (binding?.client_name ?? "")) void onPatch(acc.account_id, { client_name: v || null });
                      }}
                      className="w-36 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                    />
                  </td>
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
                  <td className="px-4 py-2">
                    <button
                      onClick={() => void copyId(acc.account_id)}
                      title="Copiar ID da conta"
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {copiedId === acc.account_id ? "Copiado!" : acc.account_id}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <InlineNumber
                      value={binding?.cpa_target ?? null}
                      onSave={(v) => onPatch(acc.account_id, { cpa_target: v })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <InlineNumber
                      value={binding?.monthly_investment ?? null}
                      onSave={(v) => onPatch(acc.account_id, { monthly_investment: v })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <InlineNumber
                      value={binding?.meta_leads ?? null}
                      onSave={(v) => onPatch(acc.account_id, { meta_leads: v })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={binding?.whatsapp_contact ?? ""}
                      placeholder="(11) 91234-5678"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (binding?.whatsapp_contact ?? ""))
                          void onPatch(acc.account_id, { whatsapp_contact: v || null });
                      }}
                      className="w-32 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <WhatsappGroupCell
                      groupId={binding?.wa_group_id ?? null}
                      groupName={binding?.wa_group_name ?? null}
                      onChange={(g) =>
                        void onPatch(acc.account_id, { wa_group_id: g?.id ?? null, wa_group_name: g?.name ?? null })
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={binding?.address ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (binding?.address ?? "")) void onPatch(acc.account_id, { address: v || null });
                      }}
                      className="w-48 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
