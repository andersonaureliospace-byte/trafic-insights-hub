"use client";

import { useEffect, useMemo, useState } from "react";
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

const INPUT_CLS =
  "w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Campo de texto que salva ao sair (blur) ou Enter. A `key` inclui o valor
// salvo pra que o campo se atualize quando o dado muda no servidor.
function TextCell({
  value,
  placeholder,
  onSave,
  className = INPUT_CLS,
}: {
  value: string | null;
  placeholder?: string;
  onSave: (v: string | null) => void;
  className?: string;
}) {
  return (
    <input
      key={value ?? ""}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== (value ?? "")) onSave(v || null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}

// Etapa 99: aba Clientes reorganizada — busca pelo nome, tela inicial só com
// Nome do cliente / Conta / CPA ideal / Invest. mensal / WhatsApp / Endereço,
// e o resto (ID da conta, Meta de leads, Grupo WhatsApp) num popup de
// configuração por cliente (botão ⚙ no fim da linha).
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
  const [search, setSearch] = useState("");
  const [configId, setConfigId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    if (!q) return accounts;
    return accounts.filter((acc) => {
      const b = bindings[acc.account_id];
      return norm(b?.client_name ?? "").includes(q) || norm(acc.name).includes(q);
    });
  }, [accounts, bindings, search]);

  const configAccount = configId ? accounts.find((a) => a.account_id === configId) ?? null : null;

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Clientes</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Clique em ⚙ pra ver ID da conta, Meta de leads e Grupo de WhatsApp.
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

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
          }}
          placeholder="Pesquisar pelo nome…"
          className="w-full max-w-sm rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length === accounts.length
            ? `${accounts.length} clientes`
            : `${filtered.length} de ${accounts.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhum cliente encontrado para &quot;{search}&quot;.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">Nome do cliente</th>
                <th className="px-4 py-2 font-medium">Conta</th>
                <th className="px-4 py-2 text-right font-medium">CPA ideal</th>
                <th className="px-4 py-2 text-right font-medium">Invest. mensal</th>
                <th className="px-4 py-2 font-medium">WhatsApp</th>
                <th className="px-4 py-2 font-medium">Endereço</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => {
                const binding = bindings[acc.account_id];
                const id = acc.account_id;
                return (
                  <tr key={acc.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2">
                      <div className="w-40">
                        <TextCell
                          value={binding?.client_name ?? null}
                          placeholder={acc.name}
                          onSave={(v) => void onPatch(id, { client_name: v })}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={adsManagerUrl(id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir no Gerenciador de Anúncios"
                        className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        {acc.name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <InlineNumber
                        value={binding?.cpa_target ?? null}
                        onSave={(v) => onPatch(id, { cpa_target: v })}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <InlineNumber
                        value={binding?.monthly_investment ?? null}
                        onSave={(v) => onPatch(id, { monthly_investment: v })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="w-36">
                        <TextCell
                          value={binding?.whatsapp_contact ?? null}
                          placeholder="(11) 91234-5678"
                          onSave={(v) => void onPatch(id, { whatsapp_contact: v })}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="w-56">
                        <TextCell
                          value={binding?.address ?? null}
                          placeholder="—"
                          onSave={(v) => void onPatch(id, { address: v })}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => setConfigId(id)}
                        title="Configurações do cliente"
                        className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        ⚙
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {configAccount ? (
        <ClienteConfigDialog
          account={configAccount}
          binding={bindings[configAccount.account_id]}
          onPatch={(patch) => onPatch(configAccount.account_id, patch)}
          onClose={() => setConfigId(null)}
        />
      ) : null}
    </div>
  );
}

function ClienteConfigDialog({
  account,
  binding,
  onPatch,
  onClose,
}: {
  account: AdAccount;
  binding: ClienteBinding | undefined;
  onPatch: (patch: ClienteBindingPatch) => Promise<void>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(account.account_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard indisponível — sem tratamento especial
    }
  }

  const title = binding?.client_name || account.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{account.name}</p>
          </div>
          <button
            onClick={onClose}
            title="Fechar"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-500">ID da conta</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{account.account_id}</span>
              <button
                onClick={() => void copyId()}
                className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500">Meta de leads</label>
            <div className="mt-1 rounded-md border border-zinc-300 dark:border-zinc-700">
              <InlineNumber
                value={binding?.meta_leads ?? null}
                onSave={(v) => onPatch({ meta_leads: v })}
                width="w-full"
                align="left"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500">Grupo de WhatsApp</label>
            <div className="mt-1">
              <WhatsappGroupCell
                groupId={binding?.wa_group_id ?? null}
                groupName={binding?.wa_group_name ?? null}
                onChange={(g) => void onPatch({ wa_group_id: g?.id ?? null, wa_group_name: g?.name ?? null })}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
