"use client";

import { useState } from "react";
import { EnvioTab } from "@/components/mensagens/envio-tab";
import { RelatoriosTab } from "@/components/mensagens/relatorios-tab";
import { AvisosTab } from "@/components/mensagens/avisos-tab";

const TABS = [
  { id: "envio", label: "Envio" },
  { id: "relatorios", label: "Relatórios" },
  { id: "avisos", label: "Avisos" },
] as const;

export default function MensagensPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("envio");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Mensagens</h1>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Envio de WhatsApp via uazapi, pros grupos vinculados às contas no Painel (ou qualquer
        grupo que sua instância participe).
      </p>

      <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
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

      {tab === "envio" ? <EnvioTab /> : null}
      {tab === "relatorios" ? <RelatoriosTab /> : null}
      {tab === "avisos" ? <AvisosTab /> : null}
    </div>
  );
}
