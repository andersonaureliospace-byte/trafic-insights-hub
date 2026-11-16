"use client";

import { useCallback, useEffect, useState } from "react";

// Etapa 320: notas / rascunhos por cliente. Cada "Salvar nota" vira um registro com data e hora (mais nova em cima).
// Fica no Supabase (user_ui_prefs "notas_clientes" = { [conta]: Nota[] }), igual em qualquer navegador.
// Aparece no Feedback por print e na ficha do cliente.
export interface Nota {
  id: string;
  texto: string;
  at: string; // ISO
  enviadaEm?: string; // Etapa 325: quando foi mandada pro gestor
  gestor?: string;
}
type Todas = Record<string, Nota[]>;

const KEY = "notas_clientes";
const norm = (id: string) => String(id).replace(/^act_/, "");

async function lerTodas(): Promise<Todas> {
  const d = await fetch(`/api/estrategia/prefs?key=${KEY}`, { cache: "no-store" }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d.value && typeof d.value === "object" ? (d.value as Todas) : {};
}
async function gravarTodas(v: Todas) {
  const d = await fetch("/api/estrategia/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: KEY, value: v }),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function NotasCliente({ clienteId, compacto = false }: { clienteId: string; compacto?: boolean }) {
  const id = norm(clienteId);
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(!compacto);

  const carregar = useCallback(async () => {
    try {
      const t = await lerTodas();
      setNotas(t[id] ?? []);
    } catch (e) {
      setErro((e as Error).message);
      setNotas([]);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as notas do cliente
    void carregar();
  }, [carregar]);

  // relê antes de gravar, pra não apagar nota salva em outra tela/navegador
  async function mudar(fn: (cur: Nota[]) => Nota[]) {
    setBusy(true);
    setErro(null);
    try {
      const t = await lerTodas();
      const next = fn(t[id] ?? []);
      await gravarTodas({ ...t, [id]: next });
      setNotas(next);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const [ok, setOk] = useState<string | null>(null);
  async function enviarGestor(texto: string): Promise<string> {
    const d = await fetch("/api/estrategia/notas/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clienteId: id, texto }),
    }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
    return d.gestor as string;
  }
  // Etapa 325: manda a nota (nova ou já salva) pro WhatsApp do gestor da conta e marca na nota
  async function enviar(n?: Nota) {
    const t = (n?.texto ?? texto).trim();
    if (!t) return;
    setBusy(true);
    setErro(null);
    setOk(null);
    try {
      const gestor = await enviarGestor(t);
      const agora = new Date().toISOString();
      setBusy(false);
      if (n) await mudar((cur) => cur.map((x) => (x.id === n.id ? { ...x, enviadaEm: agora, gestor } : x)));
      else {
        const salvo = await mudar((cur) => [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texto: t, at: agora, enviadaEm: agora, gestor }, ...cur].slice(0, 200));
        if (salvo) setTexto("");
      }
      setOk(`Enviada pro ${gestor} ✓`);
    } catch (e) {
      setErro((e as Error).message);
      setBusy(false);
    }
  }

  async function salvar() {
    const t = texto.trim();
    if (!t) return;
    const ok = await mudar((cur) => [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texto: t, at: new Date().toISOString() }, ...cur].slice(0, 200));
    if (ok) setTexto("");
  }

  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10">
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-zinc-500">
        <span>📝 Plano de ação {notas && notas.length ? <span className="font-normal">· {notas.length}</span> : null}</span>
        <span aria-hidden>{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto ? (
        <div className="mt-2 flex flex-col gap-2">
          <label htmlFor={`nota-${id}`} className="sr-only">Novo plano de ação</label>
          <textarea
            id={`nota-${id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="O que fazer nessa conta: testes, ajustes, combinado com o cliente…"
            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-white/10 dark:bg-[#141924]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={busy || !texto.trim()}
              className="h-8 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={busy || !texto.trim()}
              title="Salva e manda no WhatsApp do gestor responsável pela conta"
              className="h-8 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              📤 Salvar e enviar pro gestor
            </button>
            {ok ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{ok}</span> : null}
            {erro ? <span className="text-xs text-red-600">{erro}</span> : null}
          </div>
          {notas == null ? (
            <p className="text-xs text-zinc-500">Carregando…</p>
          ) : notas.length === 0 ? (
            <p className="text-xs text-zinc-500">Nenhum plano de ação ainda.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {notas.map((n) => (
                <li key={n.id} className="rounded-md bg-zinc-50 px-2.5 py-2 text-sm dark:bg-white/[0.03]">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span className="tabular-nums">
                      {fmt(n.at)}
                      {n.enviadaEm ? <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">· enviada pro {n.gestor ?? "gestor"} {fmt(n.enviadaEm)}</span> : null}
                    </span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => void enviar(n)} disabled={busy} className="hover:text-blue-600" title="Mandar no WhatsApp do gestor responsável">
                        {n.enviadaEm ? "Reenviar" : "Enviar pro gestor"}
                      </button>
                      <button type="button" onClick={() => setTexto(n.texto)} className="hover:text-blue-600" title="Copiar pro campo de cima pra editar e salvar de novo">
                        Usar
                      </button>
                      <button type="button" onClick={() => void mudar((cur) => cur.filter((x) => x.id !== n.id))} className="hover:text-red-600" aria-label={`Apagar plano de ação de ${fmt(n.at)}`}>
                        Apagar
                      </button>
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{n.texto}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
