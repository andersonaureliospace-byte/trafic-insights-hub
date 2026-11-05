"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Etapa 249: abas dentro de Clientes — Ficha (lista + ficha do cliente) e Feedbacks (vídeos do Gravador de Tela).
const TABS = [
  { href: "/estrategia/clientes", label: "Ficha" },
  { href: "/estrategia/clientes/feedbacks", label: "Feedbacks" },
];

export function ClientesTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-zinc-200 px-4 lg:px-6 dark:border-white/10">
      {TABS.map((t) => {
        const on = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              on
                ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
