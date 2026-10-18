"use client";

import { DescricaoTab } from "@/components/painel/descricao-tab";
import { useAccountsData } from "@/lib/hooks/use-accounts-data";

// Etapa 141: a aba Descrição (antes no Painel), agora dentro de Auditoria.
export function DescricaoSection() {
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
  if (!d.ready) return <p className="text-sm text-zinc-500">Carregando contas…</p>;
  if (d.selectedAccounts.length === 0) return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  return <DescricaoTab accounts={d.selectedAccounts} clientNames={d.clientNames} />;
}
