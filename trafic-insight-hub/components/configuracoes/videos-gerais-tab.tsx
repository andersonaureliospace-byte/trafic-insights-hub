"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Configurações → Vídeos gerais: a lista de vídeos de GERAL usada em Painel → Vídeos (Geral) e no Foco. Adiciona, renomeia e exclui aqui,
// sem mexer no código nem no banco. Os nomes são o nome do anúncio ("GERAL | PREÇO ÚNICO"): o prefixo "GERAL | " é colocado sozinho.

interface Row {
  id: string;
  name: string;
  position: number;
}

const inputCls =
  "h-9 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100";
const btnCls = "h-8 rounded-md border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function VideosGeraisTab() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/video-bank", { cache: "no-store" });
      const d = (await res.json()) as { error?: string; rows?: Row[] };
      if (d.error) throw new Error(d.error);
      setRows(d.rows ?? []);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê a lista ao abrir a aba
    void load();
  }, [load]);

  async function call(method: "POST" | "PATCH" | "DELETE", body?: unknown, query = ""): Promise<{ ok?: boolean; added?: number; skipped?: string[] } | null> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/video-bank${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = (await res.json()) as { error?: string; ok?: boolean; added?: number; skipped?: string[] };
      if (d.error) {
        setError(d.error);
        return null;
      }
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!newName.trim()) return;
    const d = await call("POST", { name: newName });
    if (d) {
      setNewName("");
      setInfo("Vídeo adicionado.");
    }
  }

  async function addBulk() {
    const names = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (names.length === 0) return;
    const d = await call("POST", { names });
    if (d) {
      setBulk("");
      setBulkOpen(false);
      const skipped = d.skipped?.length ?? 0;
      setInfo(`${d.added ?? 0} adicionado(s)${skipped ? ` · ${skipped} já estava(m) na lista` : ""}.`);
    }
  }

  async function saveEdit() {
    if (!editId) return;
    const d = await call("PATCH", { id: editId, name: editName });
    if (d) {
      setEditId(null);
      setInfo("Nome alterado.");
    }
  }

  async function remove(r: Row) {
    if (!confirm(`Excluir "${r.name}" da lista?\n\nOs anúncios na Meta não são mexidos — o vídeo só deixa de aparecer nas telas.`)) return;
    const d = await call("DELETE", undefined, `?id=${encodeURIComponent(r.id)}`);
    if (d) setInfo("Vídeo excluído.");
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle));
  }, [rows, q]);

  if (!rows) return <p className="text-sm text-zinc-500">Carregando…</p>;

  return (
    <div className="max-w-xl">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Lista dos vídeos de GERAL usada em Painel → Vídeos (Geral) e no Foco. O nome é o mesmo do anúncio (ex.: GERAL | PREÇO ÚNICO) — o
        &quot;GERAL | &quot; é colocado sozinho. Vídeos novos ou com nome alterado ganham os números no próximo <strong>Atualizar</strong> em Painel →
        Vídeos (ou na atualização automática da madrugada).
      </p>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Nome do novo vídeo (ex.: PREÇO ÚNICO)"
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={() => void add()}
            disabled={busy || !newName.trim()}
            className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Adicionar
          </button>
        </div>
        <button onClick={() => setBulkOpen((v) => !v)} className="mt-2 text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
          {bulkOpen ? "Fechar" : "Adicionar vários de uma vez"}
        </button>
        {bulkOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={5}
              placeholder={"Um vídeo por linha\nPREÇO ÚNICO\nÉ ISSO MESMO"}
              className="rounded-md border border-zinc-300 bg-transparent p-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            />
            <div>
              <button onClick={() => void addBulk()} disabled={busy || !bulk.trim()} className={btnCls}>
                Adicionar todos
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {info ? <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</p> : null}

      <div className="mt-4 flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na lista…" className={`${inputCls} flex-1`} />
        <span className="shrink-0 text-xs text-zinc-400">{q.trim() ? `${shown.length} de ${rows.length}` : `${rows.length} vídeos`}</span>
      </div>

      <div className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {shown.length === 0 ? <p className="p-4 text-sm text-zinc-500">{rows.length === 0 ? "Nenhum vídeo na lista ainda." : "Nada encontrado."}</p> : null}
        {shown.map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-3 py-2">
            {editId === r.id ? (
              <>
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit();
                    if (e.key === "Escape") setEditId(null);
                  }}
                  className={`${inputCls} min-w-0 flex-1`}
                />
                <button onClick={() => void saveEdit()} disabled={busy || !editName.trim()} className="h-8 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                  Salvar
                </button>
                <button onClick={() => setEditId(null)} className={btnCls}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200" title={r.name}>
                  {r.name}
                </span>
                <button
                  onClick={() => {
                    setEditId(r.id);
                    setEditName(r.name);
                    setInfo(null);
                    setError(null);
                  }}
                  className={btnCls}
                >
                  Editar
                </button>
                <button onClick={() => void remove(r)} disabled={busy} className={`${btnCls} text-red-600`}>
                  Excluir
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
