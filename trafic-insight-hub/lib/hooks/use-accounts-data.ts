"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { registerAccountBusinesses } from "@/lib/meta/ads-manager-link";

// Etapa 141: telas que saíram do Painel (Clientes → Configurações; Alertas, Padrão de nomes e Descrição → Auditoria) precisam
// das mesmas contas/vínculos que o Painel usa. Este hook busca isso sozinho (contas do Meta + "Contas exibidas" + vínculos
// de cada cliente) e entrega o que essas telas esperam. O Painel continua com a carga dele (não foi mexido).

export interface ClientBinding {
  ad_account_id: string;
  client_name: string | null;
  cpa_target: number | null;
  monthly_investment: number | null;
  meta_leads: number | null;
  whatsapp_contact: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
  address: string | null;
  active?: boolean | null;
}

type BindingPatch = Partial<Omit<ClientBinding, "ad_account_id">>;

function emptyBinding(accountId: string): ClientBinding {
  return {
    ad_account_id: accountId,
    client_name: null,
    cpa_target: null,
    monthly_investment: null,
    meta_leads: null,
    whatsapp_contact: null,
    wa_group_id: null,
    wa_group_name: null,
    address: null,
  };
}

export function useAccountsData() {
  const [allAccounts, setAllAccounts] = useState<AdAccount[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [bindings, setBindings] = useState<Record<string, ClientBinding>>({});
  const [bindingsLoaded, setBindingsLoaded] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/meta/accounts", { signal: AbortSignal.timeout(90_000) });
      const d = await res.json();
      if (d.error) {
        setError(String(d.error));
      } else {
        setError(null);
        registerAccountBusinesses(d.accounts ?? []);
        setAllAccounts(d.accounts ?? []);
      }
    } catch {
      setError("Não consegui carregar as contas da Meta (sem resposta do servidor).");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/selected-accounts")
      .then((r) => r.json())
      .then((d) => setSelectedIds(d.accountIds ?? []))
      .catch(() => setSelectedIds([]));
    fetch("/api/account-bindings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, ClientBinding> = {};
        for (const b of d.bindings ?? []) map[b.ad_account_id] = b;
        setBindings(map);
      })
      .catch(() => {})
      .finally(() => setBindingsLoaded(true));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca as contas do Meta ao montar (mesmo padrão do Painel)
    void loadAccounts();
  }, [loadAccounts]);

  // Todas as contas exibidas (inclusive clientes desativados — a tela Clientes precisa pra poder reativar).
  const selectedAccountsAll = useMemo(() => {
    if (!allAccounts || !selectedIds) return [];
    const set = new Set(selectedIds);
    return allAccounts.filter((a) => set.has(a.account_id));
  }, [allAccounts, selectedIds]);

  // Só os clientes ativos (o que as outras telas usam).
  const selectedAccounts = useMemo(
    () => (bindingsLoaded ? selectedAccountsAll.filter((a) => bindings[a.account_id]?.active !== false) : []),
    [selectedAccountsAll, bindings, bindingsLoaded],
  );

  const clientNames = useMemo(
    () => Object.fromEntries(selectedAccounts.map((a) => [a.account_id, bindings[a.account_id]?.client_name || a.name])),
    [selectedAccounts, bindings],
  );

  // Atualização otimista + confere se o servidor gravou (igual ao Painel).
  const patchBinding = useCallback(
    async (accountId: string, patch: BindingPatch) => {
      const previous = bindings[accountId] ?? emptyBinding(accountId);
      setBindings((prev) => ({ ...prev, [accountId]: { ...previous, ...patch } }));
      const res = await fetch("/api/account-bindings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: accountId, ...patch }),
      });
      const d = await res.json().catch(() => ({ error: "Resposta inválida do servidor." }));
      if (d.error) {
        setBindings((prev) => ({ ...prev, [accountId]: previous }));
        alert(`Não deu pra salvar: ${d.error}`);
      }
    },
    [bindings],
  );

  const ready = selectedIds !== null && allAccounts !== null && bindingsLoaded;

  return { ready, error, loadingAccounts, loadAccounts, bindings, selectedAccountsAll, selectedAccounts, clientNames, patchBinding };
}
