import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAccess, type HubRole } from "@/lib/access";
import { EstrategiaShell } from "@/components/estrategia/shell";
import { PriorityLabelsProvider } from "@/lib/priority-context";

// Etapa 238: Hub estratégico (/estrategia) — layout próprio, com menu lateral, separado do hub operacional (/painel).
export default async function EstrategiaLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Etapa 352: papel de quem está logado (gestor vê o menu enxuto)
  let role: HubRole = "estrategista";
  try {
    role = (await getAccess()).role;
  } catch {
    /* sem login: o proxy já manda pro /login */
  }
  return (
    <EstrategiaShell email={user?.email ?? null} role={role}>
      <PriorityLabelsProvider>{children}</PriorityLabelsProvider>
    </EstrategiaShell>
  );
}
