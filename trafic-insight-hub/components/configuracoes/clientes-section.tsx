"use client";

import { ClientesTab } from "@/components/painel/clientes-tab";
import { useAccountsData } from "@/lib/hooks/use-accounts-data";

// Etapa 141: a antiga aba Clientes do Painel, agora dentro de Configurações.
export function ClientesSection() {
  const d = useAccountsData();
  if (d.error && !d.ready) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {d.error}{" "}
        <button onClick={() => void d.loadAccounts()} className="font-medium underline">
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!d.ready) return <p className="text-sm text-zinc-500">Carregando clientes…</p>;
  if (d.selectedAccountsAll.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada. Escolha as contas em &quot;Contas exibidas&quot; no Painel.</p>;
  }
  return (
    <ClientesTab
      accounts={d.selectedAccountsAll}
      bindings={d.bindings}
      onPatch={d.patchBinding}
      onRefresh={d.loadAccounts}
      refreshing={d.loadingAccounts}
    />
  );
}
