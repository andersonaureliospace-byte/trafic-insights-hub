import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { NavLink } from "@/components/nav-link";
import { SignOutButton } from "@/components/sign-out-button";
import { PriorityLabelsProvider } from "@/lib/priority-context";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Trafic Insight Hub
            </span>
            <nav className="flex flex-wrap items-center gap-0.5">
              <NavLink href="/painel">Painel</NavLink>
              <NavLink href="/mensagens">Mensagens</NavLink>
              <NavLink href="/auditoria">Auditoria</NavLink>
              <NavLink href="/crm">CRM</NavLink>
              <NavLink href="/configuracoes">Configurações</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="hidden sm:inline">{user?.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <PriorityLabelsProvider>{children}</PriorityLabelsProvider>
      </main>
    </div>
  );
}
