"use client";

import { AlertasTab } from "@/components/painel/alertas-tab";
import { useAccountsData } from "@/lib/hooks/use-accounts-data";

// Etapa 141: a aba Alertas (antes no Painel), agora dentro de Auditoria. O filtro por conta usa os nomes dos clientes ativos.
export function AlertasSection() {
  const d = useAccountsData();
  return <AlertasTab accountNames={d.selectedAccounts.map((a) => d.bindings[a.account_id]?.client_name || a.name)} />;
}
