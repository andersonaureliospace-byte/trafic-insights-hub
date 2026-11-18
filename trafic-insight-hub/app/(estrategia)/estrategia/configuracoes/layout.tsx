"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Configurações do Hub estratégico: Alertas, Clientes, Gestores, Automações e Conexões numa aba só (menu de cima).
const TABS = [
  { href: "/estrategia/configuracoes/alertas", label: "Alertas" },
  { href: "/estrategia/configuracoes/clientes", label: "Clientes" },
  { href: "/estrategia/configuracoes/gestores", label: "Gestores" },
  { href: "/estrategia/configuracoes/automacoes", label: "Automações" },
  { href: "/estrategia/configuracoes/conexoes", label: "Conexões" },
];

export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 bg-white/60 px-4 lg:px-6 dark:border-white/10 dark:bg-white/[0.02]">
        <nav aria-label="Configurações" className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  on
                    ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
