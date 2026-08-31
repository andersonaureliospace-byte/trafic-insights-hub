"use client";

import { useState } from "react";
import { MetaCredentialsForm } from "@/components/meta-credentials-form";
import { WhatsappTab } from "@/components/configuracoes/whatsapp-tab";

const TABS = [
  { id: "meta", label: "Meta (Facebook)" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "status", label: "Status" },
] as const;

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("meta");

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 md:px-8">
      <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Configurações</h1>

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

      {tab === "meta" ? <MetaCredentialsForm /> : null}
      {tab === "whatsapp" ? <WhatsappTab /> : null}
      {tab === "status" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Em construção — personalizar os rótulos de prioridade usados no Painel.
        </p>
      ) : null}
    </div>
  );
}
