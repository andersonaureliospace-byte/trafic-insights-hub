"use client";

import { useState } from "react";

// Célula da coluna "Otimizado" (Acompanhamento, Etapa 36). Marcar pede o
// motivo antes de confirmar (sem popup do navegador — mesmo padrão já
// usado em Análise: tudo inline, na própria célula). Desmarcar é direto,
// sem pedir nada de novo, já que não mexe em nada no Meta, só num rótulo
// interno do Painel.
export function OptimizedCell({
  optimized,
  reason,
  onToggle,
}: {
  optimized: boolean;
  reason: string | null;
  onToggle: (next: boolean, reason?: string) => Promise<void> | void;
}) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    const value = draft.trim();
    if (!value) return;
    setSaving(true);
    await onToggle(true, value);
    setSaving(false);
    setAsking(false);
    setDraft("");
  }

  function cancel() {
    setAsking(false);
    setDraft("");
  }

  async function unmark() {
    setSaving(true);
    await onToggle(false);
    setSaving(false);
  }

  if (asking) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
            if (e.key === "Escape") cancel();
          }}
          placeholder="Por quê?"
          disabled={saving}
          className="h-7 w-32 rounded-md border border-zinc-300 bg-transparent px-1.5 text-xs outline-none focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-100"
        />
        <button
          onClick={() => void confirm()}
          disabled={saving || !draft.trim()}
          title="Confirmar"
          className="rounded-md border border-emerald-300 px-1.5 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400"
        >
          ✓
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          title="Cancelar"
          className="rounded-md border border-zinc-300 px-1.5 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          ✕
        </button>
      </div>
    );
  }

  if (optimized) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          title={reason ?? undefined}
          className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          ✓ Otimizado
        </span>
        <button
          onClick={() => void unmark()}
          disabled={saving}
          title="Desmarcar"
          className="text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          {saving ? "…" : "✕"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setAsking(true)}
      title="Marcar como otimizado hoje"
      className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      Pendente
    </button>
  );
}
