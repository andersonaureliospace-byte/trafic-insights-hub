"use client";

import { useEffect, useState } from "react";

export function InlineNumber({
  value,
  onSave,
  placeholder = "—",
  width = "w-24",
  align = "right",
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  placeholder?: string;
  // Etapa 69: CPA ideal em Acompanhamento usa uma caixa menor e alinhada à
  // esquerda (colada no "R$"), diferente do padrão (mais larga, à direita)
  // usado em Clientes — os outros usos continuam com os defaults de sempre.
  width?: string;
  align?: "left" | "right";
}) {
  const [text, setText] = useState(value == null ? "" : String(value));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o campo com o valor salvo no servidor
    setText(value == null ? "" : String(value));
  }, [value]);

  async function commit() {
    const trimmed = text.trim();
    const next = trimmed === "" ? null : Number(trimmed.replace(",", "."));
    if (next !== null && Number.isNaN(next)) {
      setText(value == null ? "" : String(value));
      return;
    }
    if (next === value) return;
    await onSave(next);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`${width} rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm tabular-nums outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100 ${
        align === "left" ? "text-left" : "text-right"
      }`}
    />
  );
}
