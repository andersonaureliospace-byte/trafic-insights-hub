"use client";

import { useState } from "react";

interface Group {
  id: string;
  name: string;
}

export function WhatsappGroupCell({
  groupId,
  groupName,
  onChange,
}: {
  groupId: string | null;
  groupName: string | null;
  onChange: (g: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function openPicker() {
    setOpen(true);
    if (!groups) void load(false);
  }

  async function load(force: boolean) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/whatsapp/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const d = await res.json();
    setLoading(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setGroups(d.groups ?? []);
  }

  const filtered = (groups ?? []).filter(
    (g) => !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <button
        onClick={openPicker}
        className="max-w-[160px] truncate rounded border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
        title={groupName ?? undefined}
      >
        {groupName ?? "Vincular grupo"}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Grupo do WhatsApp</h3>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar grupo…"
                className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {error ? (
                <p className="px-3 py-4 text-sm text-red-600">{error}</p>
              ) : loading ? (
                <p className="px-3 py-4 text-sm text-zinc-500">Carregando…</p>
              ) : (
                <>
                  {groupId ? (
                    <button
                      onClick={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                      className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      — Remover vínculo
                    </button>
                  ) : null}
                  {filtered.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-zinc-500">Nenhum grupo encontrado.</p>
                  ) : (
                    filtered.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          onChange({ id: g.id, name: g.name });
                          setOpen(false);
                        }}
                        className={`flex w-full items-center truncate rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          g.id === groupId ? "font-medium text-zinc-900 dark:text-zinc-50" : ""
                        }`}
                      >
                        {g.name}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
              <button
                onClick={() => void load(true)}
                disabled={loading}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
              >
                Atualizar grupos
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
