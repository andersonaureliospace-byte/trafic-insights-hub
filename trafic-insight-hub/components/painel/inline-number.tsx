"use client";

import { useEffect, useState } from "react";

export function InlineNumber({
  value,
  onSave,
  placeholder = "—",
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  placeholder?: string;
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
      className="w-24 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
    />
  );
}
