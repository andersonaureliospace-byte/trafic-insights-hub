"use client";

import { useRef, useState } from "react";
import { fmtCurrency } from "@/lib/format";

// Etapa 121: nome do cliente em Acompanhamento — só leitura (a edição fica na aba Clientes). Ao passar o mouse
// abre um balão discreto com o WhatsApp e o Investimento mensal cadastrados.
// O balão é "fixed" (posicionado pela posição do nome na tela) pra não ser cortado pela rolagem da tabela.
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 6 });
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
          style={{ position: "fixed", left: pos.x, top: pos.y }}
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
