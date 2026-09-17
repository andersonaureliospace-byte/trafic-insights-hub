"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";

interface Demand {
  id: string;
  ad_account_id: string | null;
  client_name: string | null;
  client_name_raw: string;
  title: string;
  items: string[];
  requested_at: string;
  sort_order: number | null;
}

// Chave de ordenação: quem já foi arrastado manualmente usa sort_order
// (crescente); quem nunca foi mexido cai pro final, ordenado da mais antiga
// pra mais nova (requested_at) — mesmo padrão do rowSortKey de Acompanhamento.
function demandSortKey(d: Demand): number {
  return d.sort_order ?? 1_000_000_000_000 + new Date(d.requested_at).getTime();
}

function fmtRequestedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

// Aba Demandas (Etapa 68) — solicitações mandadas no grupo dedicado do
// WhatsApp (Configurações → WhatsApp) viram tarefas aqui automaticamente via
// n8n + hook público. O texto de cada tarefa é só organizado (título + itens
// quando a mensagem tem lista), nunca interpretado ou resumido por IA — a
// única IA envolvida transcreve áudio literalmente antes de chegar aqui.
export function DemandasTab({
  accounts,
  clientNames,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
}) {
  const [demands, setDemands] = useState<Demand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch("/api/demands");
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setDemands(d.demands ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as demandas assim que a aba monta
    void load();
  }, []);

  const sorted = useMemo(() => {
    if (!demands) return [];
    return [...demands].sort((a, b) => demandSortKey(a) - demandSortKey(b));
  }, [demands]);

  async function persistOrder(list: Demand[]) {
    await fetch("/api/demands/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: list.map((d) => d.id) }),
    });
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId || !demands) return;
    const list = [...sorted];
    const fromIdx = list.findIndex((d) => d.id === draggedId);
    const toIdx = list.findIndex((d) => d.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    // Otimista: já grava sort_order 0..N no estado local (o servidor recebe a
    // mesma ordem em seguida) — assim a lista não "pisca" pra ordem antiga.
    const withOrder = list.map((d, i) => ({ ...d, sort_order: i }));
    setDemands(withOrder);
    void persistOrder(list);
  }

  async function handleFinalizar(id: string) {
    if (!confirm("Finalizar essa demanda? Isso apaga a tarefa — não fica histórico.")) return;
    setDemands((prev) => (prev ?? []).filter((d) => d.id !== id));
    await fetch(`/api/demands/${id}`, { method: "DELETE" });
  }

  async function handleAssignClient(id: string, accountId: string) {
    const name = accountId ? (clientNames[accountId] ?? null) : null;
    setDemands((prev) =>
      (prev ?? []).map((d) =>
        d.id === id ? { ...d, ad_account_id: accountId || null, client_name: name } : d,
      ),
    );
    setAssigningId(null);
    await fetch(`/api/demands/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId || null, client_name: name }),
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Demandas</h2>
        <button
          onClick={() => void load()}
          className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
        >
          ↻ Atualizar
        </button>
      </div>

      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Solicitações recebidas no grupo de Demandas do WhatsApp. Arraste pra reordenar por
        prioridade — sem mexer, a mais antiga fica sempre no topo.
      </p>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}

      {!demands ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma demanda pendente.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {sorted.map((d) => (
            <li
              key={d.id}
              draggable
              onDragStart={() => setDraggedId(d.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(d.id)}
              onDragEnd={() => setDraggedId(null)}
              className="flex cursor-move flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {d.client_name ?? (d.client_name_raw || "Sem cliente")}
                  </span>
                  <span className="text-xs text-zinc-400">{fmtRequestedAt(d.requested_at)}</span>
                  {!d.ad_account_id ? (
                    assigningId === d.id ? (
                      <select
                        autoFocus
                        defaultValue=""
                        onChange={(e) => void handleAssignClient(d.id, e.target.value)}
                        onBlur={() => setAssigningId(null)}
                        className="h-6 rounded border border-zinc-300 bg-transparent px-1 text-xs dark:border-zinc-700"
                      >
                        <option value="">— Selecionar conta —</option>
                        {accounts.map((acc) => (
                          <option key={acc.account_id} value={acc.account_id}>
                            {clientNames[acc.account_id] ?? acc.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAssigningId(d.id)}
                        className="rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-500 dark:border-zinc-700"
                      >
                        + atribuir cliente
                      </button>
                    )
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{d.title}</p>
                {d.items.length > 1 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    {d.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                onClick={() => void handleFinalizar(d.id)}
                className="h-8 shrink-0 rounded-md border border-emerald-300 px-2.5 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
              >
                Finalizar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
