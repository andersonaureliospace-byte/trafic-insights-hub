"use client";

import { useState } from "react";

// Seletor da coluna "Otimizado" (Acompanhamento, Etapa 37 — simplificado a
// pedido: sem motivo, sem caixa de texto, só o clique). Um clique alterna
// direto entre "Não otimizado" (cinza) e "Otimizado" (verde) — sem popup,
// sem confirmação, sem nada mais pra preencher.
export function OptimizedCell({
  optimized,
  onToggle,
}: {
  optimized: boolean;
  onToggle: (next: boolean) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    await onToggle(!optimized);
    setSaving(false);
  }

  return (
    <button
      onClick={() => void toggle()}
      disabled={saving}
      title={optimized ? "Otimizado — clique pra desmarcar" : "Clique pra marcar como otimizado"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        optimized
          ? "border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-zinc-300 bg-transparent text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full transition-colors ${
          optimized ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      />
      {saving ? "…" : optimized ? "Otimizado" : "Não otimizado"}
    </button>
  );
}
