import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { EstrategiaShell } from "@/components/estrategia/shell";
import { PriorityLabelsProvider } from "@/lib/priority-context";

// Etapa 238: Hub estratégico (/estrategia) — layout próprio, com menu lateral, separado do hub operacional (/painel).
export default async function EstrategiaLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <EstrategiaShell email={user?.email ?? null}>
      <PriorityLabelsProvider>{children}</PriorityLabelsProvider>
    </EstrategiaShell>
  );
}
