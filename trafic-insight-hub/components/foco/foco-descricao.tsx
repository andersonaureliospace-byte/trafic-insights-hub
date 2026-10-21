"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromEditor, hasImage, toEditorHtml } from "@/lib/asana/rich-html";

// Modo Foco — quadro "Descrição (Asana)" de UMA conta: a mesma descrição da aba Descrição (Auditoria). Editou? Fica como rascunho (salvo ao sair da caixa);
// só vai pro Asana quando clica em "Enviar ao Asana" — e o texto SUBSTITUI a descrição de lá. No quadro aparece só uma prévia (sem barra de rolagem);
// passar o mouse abre uma caixa maior com o texto inteiro; clicar nela (ou na prévia) libera a edição.
// Se a descrição no Asana tem formatação (negrito, lista, link), a edição usa um editor com esses botões e envia COM a formatação.

interface DescRow {
  ad_account_id: string;
  asana_task_gid: string | null;
  asana_description: string;
  asana_has_rich: boolean;
  match_status: "ok" | "not_found" | "ambiguous" | "pending";
  draft: string | null;
  synced_at: string | null;
}

const ASANA_PROJECT_GID = "1208798639166829";
const norm = (id: string) => id.replace(/^act_/, "");
const sameText = (a: string, b: string) => {
  const n = (x: string) => x.replace(/\r\n?/g, "\n").trimEnd();
  return n(a) === n(b);
};
function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

export function FocoDescricao({ accountId }: { accountId: string }) {
  const id = norm(accountId);
  const [row, setRow] = useState<DescRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [box, setBox] = useState({ top: 8, left: 8, width: 520, maxH: 420 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef(false);
  // Edição com formatação (só quando a descrição no Asana tem negrito/lista/link): texto vivo do Asana + editor.
  const [liveHtml, setLiveHtml] = useState<string | null>(null);
  const [richDraft, setRichDraft] = useState<string | null>(null); // alterações ainda não enviadas, guardadas ao fechar a caixa
  const [richDirty, setRichDirty] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/asana/descriptions", { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setMsg({ ok: false, text: d.error });
        return;
      }
      setRow(((d.rows ?? []) as DescRow[]).find((r) => norm(r.ad_account_id) === id) ?? null);
      setConfigured(Boolean(d.configured));
      setLoaded(true);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê a descrição do cliente ao abrir/trocar de conta
    void load();
  }, [load]);

  // Caixa expandida: posição fixa (não é cortada pelo quadro), alinhada à direita da prévia e dentro da tela.
  function openPanel() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(560, window.innerWidth - 16);
      const top = Math.max(8, Math.min(r.top, window.innerHeight - 12 - 360));
      setBox({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width, maxH: window.innerHeight - top - 12 });
    }
    setOpen(true);
    if (row?.asana_has_rich && liveHtml === null) void fetchLive();
  }
  async function fetchLive() {
    if (!row) return;
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "html", ad_account_id: row.ad_account_id }),
      });
      const d = await res.json();
      if (d.error) setMsg({ ok: false, text: d.error });
      else setLiveHtml(typeof d.html === "string" ? d.html : "");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  function hoverIn() {
    if (closeT.current) clearTimeout(closeT.current);
    if (!open && !openT.current) openT.current = setTimeout(() => { openT.current = null; openPanel(); }, 150);
  }
  function hoverOut() {
    if (openT.current) { clearTimeout(openT.current); openT.current = null; }
    if (closeT.current) clearTimeout(closeT.current);
    closeT.current = setTimeout(() => { if (!editingRef.current) setOpen(false); }, 250);
  }
  function startEdit() {
    if (openT.current) { clearTimeout(openT.current); openT.current = null; }
    if (!open) openPanel();
    editingRef.current = true;
    setEditing(true);
  }
  function closePanel() {
    if (edit !== null) void saveDraft();
    if (richDirty && editorRef.current) setRichDraft(editorRef.current.innerHTML);
    editingRef.current = false;
    setEditing(false);
    setOpen(false);
  }

  useEffect(() => {
    if (!open || !editing) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      closePanel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  useEffect(() => () => {
    if (openT.current) clearTimeout(openT.current);
    if (closeT.current) clearTimeout(closeT.current);
  }, []);

  async function sendRich(force = false) {
    if (!row || !editorRef.current) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_html", ad_account_id: row.ad_account_id, html: fromEditor(editorRef.current), force }),
      });
      const d = await res.json();
      if (d.error) setMsg({ ok: false, text: d.error });
      else if (d.ok) {
        setMsg({ ok: true, text: "Enviado ao Asana, com a formatação." });
        setRichDraft(null);
        setRichDirty(false);
        setLiveHtml(null);
        editingRef.current = false;
        setEditing(false);
        setOpen(false);
        await load();
      } else if (d.code === "conflict" && !force) {
        if (confirm(`${d.message}\n\nEnviar mesmo assim?`)) {
          setBusy(false);
          await sendRich(true);
          return;
        }
      } else setMsg({ ok: false, text: d.message ?? "Não foi possível enviar." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function discardRich() {
    setRichDraft(null);
    setRichDirty(false);
    setMsg(null);
    if (editorRef.current) editorRef.current.innerHTML = toEditorHtml(liveHtml ?? "");
  }

  // Botões de formatação do editor: o mouseDown não rouba a seleção do texto.
  function fmt(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    setRichDirty(true);
  }
  function addLink() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = window.prompt("Endereço do link (ex.: https://…)");
    if (!url?.trim()) return;
    if (range) {
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    fmt("createLink", /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  }

  async function syncNow() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const d = await res.json();
      if (d.error) setMsg({ ok: false, text: d.error });
      else if (d.summary && d.summary.configured === false) setMsg({ ok: false, text: "Asana não configurado." });
      setLiveHtml(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  async function saveDraft() {
    if (!row || edit === null) return;
    const draft = sameText(edit, row.asana_description) ? null : edit;
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: row.ad_account_id, draft }),
      });
      const d = await res.json();
      if (d.error) {
        setMsg({ ok: false, text: d.error });
        return;
      }
      setRow({ ...row, draft });
      setEdit(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function discard() {
    if (!row) return;
    setEdit(null);
    setMsg(null);
    if (row.draft != null) {
      await fetch("/api/asana/descriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: row.ad_account_id, draft: null }),
      });
      setRow({ ...row, draft: null });
    }
  }

  async function send(force = false) {
    if (!row) return;
    setBusy(true);
    setMsg(null);
    try {
      if (edit !== null) await saveDraft();
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", ad_account_id: row.ad_account_id, force }),
      });
      const d = await res.json();
      if (d.error) setMsg({ ok: false, text: d.error });
      else if (d.ok) {
        setMsg({ ok: true, text: "Enviado ao Asana." });
        await load();
      } else if ((d.code === "conflict" || d.code === "rich") && !force) {
        if (confirm(`${d.message}\n\nEnviar mesmo assim?`)) {
          setBusy(false);
          await send(true);
          return;
        }
      } else setMsg({ ok: false, text: d.message ?? "Não foi possível enviar." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const syncBtn = (
    <button
      onClick={() => void syncNow()}
      disabled={syncing}
      title="Atualizar as descrições a partir do Asana (todas as contas)"
      className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50 dark:border-zinc-700"
    >
      {syncing ? "…" : "↻ Asana"}
    </button>
  );

  if (!loaded) return <p className="p-3 text-sm text-zinc-500">{msg ? <span className="text-red-600">{msg.text}</span> : "Carregando…"}</p>;
  if (!configured) return <p className="p-3 text-xs text-amber-700 dark:text-amber-400">O Asana ainda não está configurado (falta ASANA_ACCESS_TOKEN na Vercel).</p>;
  if (!row || row.match_status !== "ok") {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500 dark:text-zinc-400">
        <p className={row ? "text-amber-700 dark:text-amber-400" : ""}>
          {!row
            ? "Ainda não sincronizado com o Asana."
            : row.match_status === "not_found"
              ? "Sem tarefa com esse nome no Asana. Ajuste o nome do cliente (ou da tarefa) e atualize."
              : row.match_status === "ambiguous"
                ? "Mais de uma tarefa parecida no Asana. Deixe o nome do cliente igual ao da tarefa e atualize."
                : "Ainda não sincronizado com o Asana."}
        </p>
        {syncBtn}
      </div>
    );
  }

  const text = edit ?? row.draft ?? row.asana_description;
  const richBlocked = row.asana_has_rich && liveHtml !== null && hasImage(liveHtml); // com imagem: segue em texto simples
  const richActive = row.asana_has_rich && !richBlocked;
  const dirty = richActive ? richDirty || richDraft !== null : !sameText(text, row.asana_description);
  const richCls =
    "text-sm leading-snug [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 dark:[&_code]:bg-zinc-800 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5";
  const tbBtn = "h-6 min-w-6 rounded border border-zinc-300 px-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  const asanaLink = row.asana_task_gid ? (
    <a href={`https://app.asana.com/0/${ASANA_PROJECT_GID}/${row.asana_task_gid}`} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
      Abrir no Asana
    </a>
  ) : null;
  const msgEl = msg?.text ? <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</span> : null;
  const dirtyBadge = dirty ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">não enviado</span> : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-2.5">
      <div
        ref={triggerRef}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
        onClick={startEdit}
        title="Passe o mouse para ver tudo · clique para editar"
        className="min-h-0 flex-1 cursor-pointer overflow-hidden rounded-md border border-zinc-200 p-2 text-sm leading-snug whitespace-pre-wrap text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 [mask-image:linear-gradient(to_bottom,black_80%,transparent)]"
      >
        {text.trim() ? text : <span className="italic text-zinc-400">Sem descrição no Asana. Clique para escrever.</span>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400">
        {dirtyBadge}
        {msgEl}
        <span className="ml-auto flex items-center gap-2">
          {ago(row.synced_at)}
          {asanaLink}
          {syncBtn}
        </span>
      </div>

      {open ? (
        <div
          ref={panelRef}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxH, height: editing ? Math.min(box.maxH, 440) : undefined }}
          className="fixed z-50 flex flex-col gap-2 rounded-xl border border-zinc-300 bg-white p-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {editing && richActive ? (
            liveHtml === null ? (
              <p className="flex-1 text-xs text-zinc-400">Carregando a formatação do Asana…</p>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-1" onMouseDown={(e) => e.preventDefault()}>
                  <button type="button" className={`${tbBtn} font-bold`} onClick={() => fmt("bold")} title="Negrito">B</button>
                  <button type="button" className={`${tbBtn} italic`} onClick={() => fmt("italic")} title="Itálico">I</button>
                  <button type="button" className={`${tbBtn} underline`} onClick={() => fmt("underline")} title="Sublinhado">U</button>
                  <button type="button" className={tbBtn} onClick={() => fmt("insertUnorderedList")} title="Lista com marcadores">• Lista</button>
                  <button type="button" className={tbBtn} onClick={() => fmt("insertOrderedList")} title="Lista numerada">1. Lista</button>
                  <button type="button" className={tbBtn} onClick={addLink} title="Transformar o texto selecionado em link">Link</button>
                </div>
                <div
                  ref={(el) => {
                    editorRef.current = el;
                    if (el && !el.dataset.ready) {
                      el.dataset.ready = "1";
                      el.innerHTML = richDraft ?? toEditorHtml(liveHtml);
                      el.focus();
                    }
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => setRichDirty(true)}
                  onKeyDown={(e) => { if (e.key === "Escape") closePanel(); }}
                  className={`min-h-[8rem] w-full flex-1 overflow-auto rounded-md border border-zinc-300 p-2 whitespace-pre-wrap focus:outline-none dark:border-zinc-700 ${richCls}`}
                />
              </>
            )
          ) : editing ? (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setEdit(e.target.value)}
              onBlur={() => void saveDraft()}
              onKeyDown={(e) => { if (e.key === "Escape") closePanel(); }}
              placeholder="Sem descrição no Asana."
              className="min-h-[8rem] w-full flex-1 resize-none rounded-md border border-zinc-300 bg-transparent p-2 text-sm leading-snug dark:border-zinc-700"
            />
          ) : richActive && liveHtml !== null ? (
            <div
              onClick={startEdit}
              title="Clique para editar"
              className={`min-h-0 flex-1 cursor-text overflow-auto whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 ${richCls}`}
              dangerouslySetInnerHTML={{ __html: richDraft ?? toEditorHtml(liveHtml) }}
            />
          ) : (
            <div onClick={startEdit} title="Clique para editar" className="min-h-0 flex-1 cursor-text overflow-auto text-sm leading-snug whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
              {text.trim() ? text : <span className="italic text-zinc-400">Sem descrição no Asana. Clique para escrever.</span>}
            </div>
          )}
          {editing ? (
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
              <button
                onClick={() => void (richActive ? sendRich() : send())}
                disabled={!dirty || busy || (richActive && liveHtml === null)}
                className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {busy ? "Enviando…" : "Enviar ao Asana"}
              </button>
              {dirty ? (
                <button onClick={() => (richActive ? discardRich() : void discard())} className="h-7 rounded-md border border-zinc-300 px-2.5 text-xs font-medium dark:border-zinc-700">
                  Voltar ao do Asana
                </button>
              ) : null}
              <button onClick={closePanel} className="h-7 rounded-md border border-zinc-300 px-2.5 text-xs font-medium dark:border-zinc-700">
                Fechar
              </button>
              {dirtyBadge}
              {richBlocked ? (
                <span className="text-[11px] text-amber-600" title="A descrição no Asana tem imagem. Enviar como texto perde a formatação e a imagem — se preferir, edite direto no Asana.">
                  tem imagem: envia só texto
                </span>
              ) : richActive ? (
                <span className="text-[11px] text-zinc-400">edita com formatação</span>
              ) : null}
              {msgEl}
            </div>
          ) : (
            <p className="shrink-0 text-[11px] text-zinc-400">Clique no texto para editar</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
