"use client";

import { useRef, useState } from "react";

// Lembrete discreto da formatação condicional: um "i" pequeno ao lado do título da coluna; ao passar o mouse (ou focar com Tab)
// abre um balão com o que cada cor significa. O balão é "fixed" (posicionado pela posição do ícone) pra não ser cortado pela rolagem
// da tabela, e perto da borda da direita é puxado pra dentro da tela — mesmo padrão do ClientNameHover.
export type LegendColor = "green" | "orange" | "red" | "none";

const DOT: Record<LegendColor, string> = {
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  none: "bg-zinc-400",
};

export function ColorLegend({
  title,
  intro,
  items,
  note,
}: {
  title: string;
  intro?: string;
  items: Array<{ color: LegendColor; label: string }>;
  note?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const W = 288;

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)), y: r.bottom + 6 });
  }

  return (
    <span
      ref={ref}
      tabIndex={0}
      role="note"
      aria-label={`Como ler as cores de ${title}`}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
      className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-zinc-400 align-middle text-[9px] font-semibold normal-case leading-none text-zinc-400 outline-none hover:border-zinc-200 hover:text-zinc-200 focus:border-zinc-200 focus:text-zinc-200"
    >
      i
      {pos ? (
        <span
          role="tooltip"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: W }}
          className="pointer-events-none z-50 whitespace-normal rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case tracking-normal shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{title}</span>
          {intro ? <span className="mt-1 block text-zinc-500 dark:text-zinc-400">{intro}</span> : null}
          <span className="mt-1.5 block space-y-1">
            {items.map((it) => (
              <span key={it.label} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-200">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[it.color]}`} />
                <span>{it.label}</span>
              </span>
            ))}
          </span>
          {note ? <span className="mt-1.5 block text-zinc-500 dark:text-zinc-400">{note}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
