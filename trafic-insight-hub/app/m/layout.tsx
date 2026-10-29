import type { ReactNode } from "react";
import { PriorityLabelsProvider } from "@/lib/priority-context";
import { MobileTabs } from "@/components/mobile/mobile-tabs";
import { MobileShell } from "@/components/mobile/mobile-shell";

// Etapa 221: app no celular — telas rápidas (Alertas, Clientes, Conjuntos) com barra de abas embaixo.
// Login: o proxy.ts já manda pra /login quem não estiver logado.
export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-50 dark:bg-zinc-950">
      <header
        className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 px-4 pb-2 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/90"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Traffic</span>
      </header>
      <main className="flex-1 px-3 py-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}>
        <PriorityLabelsProvider>
          <MobileShell />
          {children}
        </PriorityLabelsProvider>
      </main>
      <MobileTabs />
    </div>
  );
}
