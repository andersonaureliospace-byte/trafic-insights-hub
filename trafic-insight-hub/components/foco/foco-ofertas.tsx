"use client";

import { useCallback, useEffect, useState } from "react";
import { OffersCell } from "@/components/painel/descricao-tab";
import type { OffersSummary } from "@/lib/offers/rule";

// Modo Foco — quadro "Ofertas ativas" (o mesmo da aba Descrição, em Auditoria): GERAL / EXAME / PROMO / BOLETO do mês corrente na conta.
// Lê o retrato guardado (refeito 05h20 e 12h pelo n8n); o ↻ recalcula só essa conta.

const norm = (id: string) => id.replace(/^act_/, "");

function atTxt(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", " às");
}

export function FocoOfertas({ accountId }: { accountId: string }) {
  const id = norm(accountId);
  const [entry, setEntry] = useState<{ at: string; summary: OffersSummary } | null>(null);
  const [isIvs, setIsIvs] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/offers", { cache: "no-store" });
      const d = (await res.json()) as { error?: string; accounts?: Record<string, { at: string; summary: OffersSummary }>; ivsIds?: string[] };
      if (d.error) throw new Error(d.error);
      setEntry(d.accounts?.[id] ?? null);
      setIsIvs((d.ivsIds ?? []).includes(id));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o retrato das ofertas ao abrir/trocar de conta
    void read();
  }, [read]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: [id] }),
      });
      const d = (await res.json()) as { error?: string; accounts?: Record<string, { at: string; summary: OffersSummary }>; failed?: string[] };
      if (d.error) throw new Error(d.error);
      if ((d.failed ?? []).length > 0) setError("A Meta não respondeu (limite de requisições). Tente de novo.");
      if (d.accounts?.[id]) setEntry(d.accounts[id]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">{entry ? `atualizado ${atTxt(entry.at)}` : ""}</span>
        {isIvs ? (
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Buscando…" : "↻"}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {!loaded ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !isIvs ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Só contas IVS (padrão de nomes).</p>
      ) : entry ? (
        <OffersCell s={entry.summary} size="sm" />
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Ainda não calculado — clique em ↻.</p>
      )}
    </div>
  );
}
