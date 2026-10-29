"use client";

import { useState } from "react";
import { NEXT_STATE, OPT_DOT, OPT_LABEL, OPT_PILL, OPT_TITLE, type OptState } from "@/lib/optimize-state";

// Seletor da coluna "Otimizado" (Acompanhamento). Etapa 226: 3 estados — um clique avança
// Pendente → Otimizar → Otimizado → Pendente. Sem popup, sem confirmação.
export function OptimizedCell({ state, onChange }: { state: OptState; onChange: (next: OptState) => Promise<void> | void }) {
  const [saving, setSaving] = useState(false);

  async function advance() {
    setSaving(true);
    await onChange(NEXT_STATE[state]);
    setSaving(false);
  }

  return (
    <button
      onClick={() => void advance()}
      disabled={saving}
      title={OPT_TITLE[state]}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${OPT_PILL[state]}`}
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full transition-colors ${OPT_DOT[state]}`} />
      {saving ? "…" : OPT_LABEL[state]}
    </button>
  );
}
