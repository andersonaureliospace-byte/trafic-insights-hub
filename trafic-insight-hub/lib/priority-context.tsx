"use client";

// Deixa os rótulos/cores de prioridade (personalizáveis em Configurações >
// Status) disponíveis em qualquer tela sem cada uma ter que buscar de novo
// — o Painel, o diálogo de status em massa e a própria tela de
// Configurações compartilham o mesmo estado.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PRIORITY_OPTIONS, type PriorityOption } from "@/lib/format";

interface PriorityContextValue {
  options: PriorityOption[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const PriorityContext = createContext<PriorityContextValue | null>(null);

export function PriorityLabelsProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<PriorityOption[]>(DEFAULT_PRIORITY_OPTIONS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/priority-labels");
      const d = await res.json();
      setOptions(d.options ?? DEFAULT_PRIORITY_OPTIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <PriorityContext.Provider value={{ options, loading, refresh }}>{children}</PriorityContext.Provider>;
}

export function usePriorityOptions(): PriorityContextValue {
  const ctx = useContext(PriorityContext);
  if (!ctx) throw new Error("usePriorityOptions precisa estar dentro de <PriorityLabelsProvider>.");
  return ctx;
}
