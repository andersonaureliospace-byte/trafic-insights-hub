"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Seletor de conta com busca por nome (modo Foco): clique, digite parte do nome e escolha (setas + Enter também funcionam).

export interface PickerOption {
  id: string;
  name: string;
}

const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ContaPicker({ options, value, onChange }: { options: PickerOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) ?? null;

  const shown = useMemo(() => {
    const needle = flat(q.trim());
    return needle ? options.filter((o) => flat(o.name).includes(needle)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(o: PickerOption) {
    onChange(o.id);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={box} className="relative">
      <input
        value={open ? q : current?.name ?? ""}
        placeholder={current ? current.name : "Buscar conta pelo nome…"}
        onFocus={(e) => {
          setOpen(true);
          setQ("");
          setHi(0);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (shown[hi]) pick(shown[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        className="h-9 w-72 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {open ? (
        <ul className="absolute left-0 top-10 z-40 max-h-80 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {shown.length === 0 ? <li className="px-3 py-2 text-zinc-500">Nenhuma conta com esse nome.</li> : null}
          {shown.map((o, i) => (
            <li
              key={o.id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === hi ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${o.id === value ? "font-semibold" : ""}`}
            >
              {o.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
