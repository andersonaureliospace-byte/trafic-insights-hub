"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ContaLateral, type FiltroOpt } from "@/components/foco/conta-filtros";

// Etapa 221: app no celular — lista de clientes do Foco (CPA e Ritmo). Tocar num cliente abre os conjuntos dele.
interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  cpa_target?: number | null;
  monthly_investment?: number | null;
  optimized?: boolean;
  to_optimize?: boolean;
  priority?: string | null;
  sort_order?: number | null;
  active?: boolean;
}

export function MobileClientes() {
  const router = useRouter();
  const [opts, setOpts] = useState<FiltroOpt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, b] = (await Promise.all([
          fetch("/api/selected-accounts").then((r) => r.json()),
          fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json()),
        ])) as [{ accountIds?: string[] }, { bindings?: Binding[] }];
        const ids = new Set(a.accountIds ?? []);
        setOpts(
          (b.bindings ?? [])
            .filter((x) => ids.has(x.ad_account_id) && x.active !== false)
            .map((x) => ({
              id: x.ad_account_id,
              name: (x.client_name ?? "").trim() || x.ad_account_id,
              cpaTarget: x.cpa_target ?? null,
              monthlyInvestment: x.monthly_investment ?? null,
              optimized: !!x.optimized,
              toOptimize: !!x.to_optimize,
              priority: x.priority ?? null,
              sortOrder: x.sort_order ?? null,
            })),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!opts) return <p className="text-sm text-zinc-500">Carregando clientes…</p>;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <ContaLateral opts={opts} value="" onChoose={(id) => router.push(`/m/conjuntos?conta=${encodeURIComponent(id)}`)} />
    </div>
  );
}
