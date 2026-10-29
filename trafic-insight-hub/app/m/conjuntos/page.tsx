"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConjuntosConta } from "@/components/painel/conjuntos-conta";

// Etapa 221: app no celular — Conjuntos da conta (pausar, reativar, orçamento, criativos). ?conta=ID abre já na conta.
function Inner() {
  const conta = useSearchParams().get("conta") ?? undefined;
  const [accounts, setAccounts] = useState<Array<{ account_id: string; name: string }> | null>(null);

  useEffect(() => {
    (async () => {
      const [a, b] = (await Promise.all([
        fetch("/api/selected-accounts").then((r) => r.json()),
        fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json()),
      ])) as [
        { accountIds?: string[] },
        { bindings?: Array<{ ad_account_id: string; client_name?: string | null; active?: boolean }> },
      ];
      const ids = new Set(a.accountIds ?? []);
      setAccounts(
        (b.bindings ?? [])
          .filter((x) => ids.has(x.ad_account_id) && x.active !== false)
          .map((x) => ({ account_id: x.ad_account_id, name: (x.client_name ?? "").trim() || x.ad_account_id })),
      );
    })().catch(() => setAccounts([]));
  }, []);

  if (!accounts) return <p className="text-sm text-zinc-500">Carregando contas…</p>;
  return <ConjuntosConta key={conta ?? "-"} accounts={accounts} initialAccountId={conta} />;
}

export default function MobileConjuntosPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
      <Inner />
    </Suspense>
  );
}
