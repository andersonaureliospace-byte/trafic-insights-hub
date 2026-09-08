"use client";

import { useState } from "react";

export interface FocusGroup {
  id: string;
  name: string;
  accountIds: string[];
}

export function FocusGroupsBar({
  accounts,
  groups,
  activeGroupId,
  onGroupsChange,
  onActiveGroupChange,
}: {
  accounts: { account_id: string; name: string }[];
  groups: FocusGroup[];
  activeGroupId: string | null;
  onGroupsChange: (groups: FocusGroup[]) => Promise<void>;
  onActiveGroupChange: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState<FocusGroup | null>(null);
  const [saving, setSaving] = useState(false);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  function openNew() {
    setEditing({ id: "", name: "", accountIds: [] });
  }

  function openEdit(g: FocusGroup) {
    setEditing({ ...g, accountIds: [...g.accountIds] });
  }

  async function handleSave() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setSaving(true);
    let next: FocusGroup[];
    let newId: string | null = null;
    if (editing.id) {
      next = groups.map((g) => (g.id === editing.id ? { ...editing, name } : g));
    } else {
      newId = crypto.randomUUID();
      next = [...groups, { ...editing, id: newId, name }];
    }
    await onGroupsChange(next);
    setSaving(false);
    setEditing(null);
    if (newId) onActiveGroupChange(newId);
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esse grupo de foco?")) return;
    const next = groups.filter((g) => g.id !== id);
    await onGroupsChange(next);
    if (activeGroupId === id) onActiveGroupChange(null);
  }

  function toggleAccountInEditing(accountId: string) {
    setEditing((prev) => {
      if (!prev) return prev;
      const has = prev.accountIds.includes(accountId);
      return {
        ...prev,
        accountIds: has ? prev.accountIds.filter((id) => id !== accountId) : [...prev.accountIds, accountId],
      };
    });
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <select
          value={activeGroupId ?? ""}
          onChange={(e) => onActiveGroupChange(e.target.value || null)}
          className="h-8 max-w-[170px] rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
        >
          <option value="">Todas as contas</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.accountIds.length})
            </option>
          ))}
        </select>
        {activeGroup ? (
          <button
            onClick={() => openEdit(activeGroup)}
            className="h-8 rounded-md border border-zinc-300 px-2 text-xs font-medium dark:border-zinc-700"
          >
            Editar
          </button>
        ) : null}
        {activeGroup ? (
          <button
            onClick={() => handleDelete(activeGroup.id)}
            className="h-8 rounded-md border border-zinc-300 px-2 text-xs font-medium text-red-600 dark:border-zinc-700"
          >
            Excluir
          </button>
        ) : null}
        <button
          onClick={openNew}
          className="h-8 rounded-md border border-dashed border-zinc-300 px-2 text-xs font-medium text-zinc-500 dark:border-zinc-700"
        >
          + Grupo de foco
        </button>
      </div>

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {editing.id ? "Editar grupo de foco" : "Novo grupo de foco"}
              </h2>
              <input
                value={editing.name}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                placeholder="Nome do grupo"
                className="mt-3 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {accounts.length === 0 ? (
                <p className="px-3 py-6 text-sm text-zinc-500">Nenhuma conta exibida no Painel ainda.</p>
              ) : (
                accounts.map((a) => (
                  <label
                    key={a.account_id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={editing.accountIds.includes(a.account_id)}
                      onChange={() => toggleAccountInEditing(a.account_id)}
                      className="size-4"
                    />
                    <span className="flex-1 truncate">{a.name}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <span className="text-xs text-zinc-500">{editing.accountIds.length} conta(s)</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editing.name.trim()}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
