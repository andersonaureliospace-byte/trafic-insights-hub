"use client";

import { useRef, useState } from "react";
import { fmtCurrency } from "@/lib/format";

// Etapa 121: nome do cliente em Acompanhamento — só leitura (a edição fica na aba Clientes). Ao passar o mouse
// abre um balão discreto com o WhatsApp e o Investimento mensal cadastrados.
// O balão é "fixed" (posicionado pela posição do nome na tela) pra não ser cortado pela rolagem da tabela.
// Etapa 126: perto da borda de baixo da tela (últimas linhas) o balão abre PRA CIMA do nome — antes ficava
// escondido atrás da barra de tarefas — e perto da borda da direita é puxado pra dentro da tela.
export function ClientNameHover({
  name,
  whatsapp,
  monthlyInvestment,
}: {
  name: string;
  whatsapp: string | null | undefined;
  monthlyInvestment: number | null | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const BALLOON_H = 110; // altura aproximada do balão (3 linhas)
  const BALLOON_W = 260;

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = window.innerHeight - r.bottom < BALLOON_H + 24;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - BALLOON_W - 8));
    setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
  }

  const wa = whatsapp?.trim();

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      className="inline-block max-w-[9rem] cursor-default truncate align-middle text-sm"
    >
      {name}
      {pos ? (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            transform: pos.above ? "translateY(-100%)" : undefined,
          }}
          className="pointer-events-none z-50 w-max max-w-[16rem] whitespace-normal rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{name}</span>
          <span className="mt-1 block text-zinc-500 dark:text-zinc-400">
            WhatsApp: <span className="text-zinc-800 dark:text-zinc-200">{wa ? wa : "não cadastrado"}</span>
          </span>
          <span className="block text-zinc-500 dark:text-zinc-400">
            Investimento mensal:{" "}
            <span className="text-zinc-800 dark:text-zinc-200">
              {monthlyInvestment != null ? fmtCurrency(monthlyInvestment) : "não cadastrado"}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
