"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/m", label: "Alertas", icon: "🔔" },
  { href: "/m/clientes", label: "Clientes", icon: "📊" },
  { href: "/m/conjuntos", label: "Conjuntos", icon: "🎯" },
];

export function MobileTabs() {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-zinc-200 bg-white/95 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t) => {
        const active = t.href === "/m" ? path === "/m" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              active ? "text-sky-600 dark:text-sky-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
