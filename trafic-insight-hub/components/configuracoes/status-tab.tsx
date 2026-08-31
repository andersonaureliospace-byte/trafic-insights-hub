"use client";

import { useState } from "react";
import { usePriorityOptions } from "@/lib/priority-context";
import type { PriorityOption } from "@/lib/format";

export function StatusTab() {
  const { options, loading, refresh } = usePriorityOptions();
  const [draft, setDraft] = useState<PriorityOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rows = draft ?? options;

  function edit(id: string, patch: Partial<PriorityOption>) {
    setSaved(false);
    setDraft((rows ?? options).map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/priority-labels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: rows }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    await refresh();
    setDraft(null);
    setSaved(true);
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Carregando…</p>;
  }

  return (
    <div className="max-w-xl">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Personalize o rótulo e a cor de cada nível de prioridade usado no Painel e na atualização
        de status em massa. A ordem e o critério de classificação automática (CPA vs. meta) não
        mudam — só como cada nível aparece na tela.
      </p>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <input
              type="color"
              value={p.color}
              onChange={(e) => edit(p.id, { color: e.target.value })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
            />
            <input
              value={p.label}
              onChange={(e) => edit(p.id, { label: e.target.value })}
              className="h-9 flex-1 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            />
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Salvo.</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        {draft ? (
          <button
            onClick={() => setDraft(null)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            Descartar alterações
          </button>
        ) : null}
      </div>
    </div>
  );
}
