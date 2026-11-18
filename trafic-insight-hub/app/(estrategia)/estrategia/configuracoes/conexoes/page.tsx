"use client";

import { useState } from "react";
import { PageHeader } from "@/components/estrategia/shell";
import { MetaCredentialsForm } from "@/components/meta-credentials-form";
import { WhatsappTab } from "@/components/configuracoes/whatsapp-tab";
import { StatusTab } from "@/components/configuracoes/status-tab";

// Conexões (antes em /configuracoes, no visual do Hub antigo): token da Meta, WhatsApp (uazapi) e nomes/cores da prioridade.
const TABS = [
  { id: "meta", label: "Meta (Facebook)" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "status", label: "Prioridade" },
] as const;

export default function ConexoesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("meta");
  return (
    <div className="flex flex-col">
      <PageHeader title="Conexões" sub="Token da Meta, WhatsApp do Hub e nomes/cores da prioridade" noFilter />
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                tab === t.id ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="max-w-[900px]">
          {tab === "meta" ? <MetaCredentialsForm /> : null}
          {tab === "whatsapp" ? <WhatsappTab /> : null}
          {tab === "status" ? <StatusTab /> : null}
        </div>
      </div>
    </div>
  );
}
