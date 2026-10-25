"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";

// Etapa 158: conjuntos em "standby" — no sábado/domingo o orçamento cai pra R$10 (bom desempenho, mais de 3 dias ativos ou acima da meta)
// e no domingo 05h todos voltam pra R$15 e saem desta lista. "Não reduzido" = CBO, orçamento vitalício ou já em R$10 ou menos.
interface StandbyItem {
  adset_id: string;
  ad_account_id: string;
  client_name: string | null;
  adset_name: string | null;
  kind: "standby" | "no_cut";
  reason: string | null;
  from_budget: number | null;
  to_budget: number | null;
  started_at: string;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function StandbySection() {
  const [items, setItems] = useState<StandbyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/standby", { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setError(String(d.error));
        setItems([]);
      } else {
        setItems(d.items ?? []);
      }
    } catch {
      setError("Não consegui carregar o standby.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a lista ao abrir a aba
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !needle || `${i.client_name ?? ""} ${i.adset_name ?? ""}`.toLowerCase().includes(needle));
  }, [items, q]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Standby</h2>
          {items ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{items.length} conjunto{items.length === 1 ? "" : "s"}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente ou conjunto"
            className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button onClick={() => void load()} className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700">
            ↻ Atualizar
          </button>
        </div>
      </div>
      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        No sábado e no domingo o orçamento dos conjuntos de bom desempenho ou com mais de 3 dias ativos cai pra R$10 (os criativos continuam ativos).
        Também entram aqui os conjuntos que ficaram acima da meta no fim de semana — primeiro reduz o orçamento, depois pausa criativo e conjunto.
        No domingo às 05h todos voltam pra R$15 e saem desta lista.
      </p>
      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {items === null ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : shown.length === 0 && !error ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">Nenhum conjunto em standby agora.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Conjunto</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2 font-medium">Orçamento</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium">Volta</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.adset_id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                  <td className="whitespace-nowrap px-3 py-1.5">{i.client_name ?? i.ad_account_id}</td>
                  <td className="max-w-[420px] truncate px-3 py-1.5" title={i.adset_name ?? ""}>
                    {i.adset_name ?? i.adset_id}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{i.reason ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {i.kind === "standby" && i.from_budget != null && i.to_budget != null ? (
                      `${fmtCurrency(i.from_budget)} → ${fmtCurrency(i.to_budget)}`
                    ) : (
                      <span className="text-zinc-500">não reduzido</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{fmtWhen(i.started_at)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600 dark:text-zinc-400">
                    {i.kind === "standby" ? "domingo 05h → R$ 15,00" : "domingo 05h (sai da lista)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
