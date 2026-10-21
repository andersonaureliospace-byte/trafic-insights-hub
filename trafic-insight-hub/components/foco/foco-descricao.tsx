"use client";

import { useCallback, useEffect, useState } from "react";

// Modo Foco — quadro "Descrição (Asana)" de UMA conta: a mesma descrição da aba Descrição (Auditoria). Editou? Fica como rascunho (salvo ao sair da caixa);
// só vai pro Asana quando clica em "Enviar ao Asana" — e o texto SUBSTITUI a descrição de lá. A caixa ocupa o espaço que sobra no quadro (rola só se o texto for maior).

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
  const dirty = !sameText(text, row.asana_description);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5">
      <textarea
        value={text}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={() => void saveDraft()}
        placeholder="Sem descrição no Asana."
        className="min-h-[4rem] w-full flex-1 resize-none rounded-md border border-zinc-300 bg-transparent p-2 text-sm leading-snug dark:border-zinc-700"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          onClick={() => void send()}
          disabled={!dirty || busy}
          className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Enviando…" : "Enviar ao Asana"}
        </button>
        {dirty ? (
          <button onClick={() => void discard()} className="h-7 rounded-md border border-zinc-300 px-2.5 text-xs font-medium dark:border-zinc-700">
            Voltar ao do Asana
          </button>
        ) : null}
        {dirty ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">não enviado</span> : null}
        {row.asana_has_rich ? (
          <span className="text-[11px] text-zinc-400" title="A descrição no Asana tem negrito, lista ou link. Ao enviar como texto simples, isso se perde.">
            tem formatação no Asana
          </span>
        ) : null}
        {msg?.text ? <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</span> : null}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
          {ago(row.synced_at)}
          {row.asana_task_gid ? (
            <a href={`https://app.asana.com/0/${ASANA_PROJECT_GID}/${row.asana_task_gid}`} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
              Abrir no Asana
            </a>
          ) : null}
          {syncBtn}
        </span>
      </div>
    </div>
  );
}
