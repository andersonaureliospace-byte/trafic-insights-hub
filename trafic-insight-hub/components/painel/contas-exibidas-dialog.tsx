"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";

export function ContasExibidasDialog({
  open,
  onClose,
  selectedIds,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseta a seleção toda vez que o diálogo abre
    setChecked(new Set(selectedIds));
    setError(null);
    if (accounts) return;
    fetch("/api/meta/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setAccounts(d.accounts ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || a.account_id.includes(q),
    );
  }, [accounts, search]);

  if (!open) return null;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    await onSave(Array.from(checked));
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Contas exibidas</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Marque só as contas que você quer acompanhar no Painel — nunca aparece tudo por padrão.
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou ID…"
            className="mt-3 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <p className="px-3 py-6 text-sm text-red-600">{error}</p>
          ) : !accounts ? (
            <p className="px-3 py-6 text-sm text-zinc-500">Carregando contas…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-sm text-zinc-500">Nenhuma conta encontrada.</p>
          ) : (
            filtered.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={checked.has(a.account_id)}
                  onChange={() => toggle(a.account_id)}
                  className="size-4"
                />
                <span className="flex-1 truncate">{a.name}</span>
                <span className="font-mono text-xs text-zinc-400">{a.account_id}</span>
              </label>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">{checked.size} selecionada(s)</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
