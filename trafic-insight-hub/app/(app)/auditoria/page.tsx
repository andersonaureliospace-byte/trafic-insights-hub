"use client";

import { useState } from "react";
import { AlertasSection } from "@/components/auditoria/alertas-section";
import { StandbySection } from "@/components/auditoria/standby-section";
import { DescricaoSection } from "@/components/auditoria/descricao-section";
import { PadraoNomesTab } from "@/components/painel/padrao-nomes-tab";

// Etapa 141: Auditoria virou o lugar das telas de "conferência": Alertas, Padrão de nomes e Descrição.
// Etapa 197: a aba "Verificações" saiu — localização + erros rodam sozinhas no n8n e o que acham vai pra aba Alertas.
const TABS = [
  { id: "alertas", label: "Alertas" },
  { id: "standby", label: "Standby" },
  { id: "padrao-nomes", label: "Padrão de nomes" },
  { id: "descricao", label: "Descrição" },
] as const;

export default function AuditoriaPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("alertas");
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Auditoria</h1>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Alertas das automações (inclusive as verificações de localização e de erros), padrão de nomes e descrições.
      </p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "alertas" ? <AlertasSection /> : null}
      {tab === "standby" ? <StandbySection /> : null}
      {tab === "padrao-nomes" ? <PadraoNomesTab /> : null}
      {tab === "descricao" ? <DescricaoSection /> : null}
    </div>
  );
}
