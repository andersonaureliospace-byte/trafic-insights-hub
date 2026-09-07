"use client";

// Etapa 39: hook compartilhado pra lembrar a aba ativa do Painel + os
// filtros de cada aba entre uma sessão e outra (F5 não joga mais o usuário
// de volta pra Visão Geral do zero). Guarda no Supabase (via
// /api/painel-ui-state), nunca em localStorage/sessionStorage — mesmo
// critério já usado na reordenação por arrastar-e-soltar de Acompanhamento,
// pra valer igual em qualquer navegador/computador.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PainelUiState {
  tab?: string;
  acompanhamento?: Record<string, unknown>;
  analise?: Record<string, unknown>;
  visaoGeral?: Record<string, unknown>;
}

// Debounce — não manda uma requisição a cada tecla digitada num campo de
// busca, só depois que o usuário parar de mexer por um instante.
const SAVE_DELAY_MS = 600;

export function usePainelUiState() {
  // null = ainda carregando (primeira leitura do Supabase ainda não voltou).
  const [state, setState] = useState<PainelUiState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PainelUiState>({});

  useEffect(() => {
    fetch("/api/painel-ui-state")
      .then((r) => r.json())
      .then((d) => setState(d.state ?? {}));
  }, []);

  const patch = useCallback((partial: PainelUiState) => {
    pendingRef.current = { ...pendingRef.current, ...partial };
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const body = pendingRef.current;
      pendingRef.current = {};
      void fetch("/api/painel-ui-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: body }),
      });
    }, SAVE_DELAY_MS);
  }, []);

  return { state, patch };
}
