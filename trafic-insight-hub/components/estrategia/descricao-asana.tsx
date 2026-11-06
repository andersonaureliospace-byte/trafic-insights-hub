"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, ago } from "@/components/estrategia/ui";

// Etapa 259: descrição do cliente no Asana, dentro da ficha do Hub estratégico (antes só existia no Hub operacional,
// que está em standby). Buscar = traz do Asana agora (a cópia automática também roda de 30 em 30 min em horário
// comercial). Enviar = grava o texto como a descrição da tarefa no Asana (substitui o que está lá).

interface Row {
  ad_account_id: string;
  asana_task_gid: string | null;
  asana_task_name: string | null;
  asana_description: string;
  asana_has_rich: boolean;
  match_status: "ok" | "not_found" | "ambiguous" | "pending";
  draft: string | null;
  synced_at: string | null;
}

const norm = (id: string) => String(id).replace(/^act_/, "");
const PROJECT = "1208798639166829";

async function call(method: string, body?: unknown) {
  const d = await fetch("/api/asana/descriptions", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d;
}

export function DescricaoAsana({ accountId, clientName }: { accountId: string; clientName: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "buscar" | "enviar" | "descartar">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // aviso de conflito/formatação antes de forçar

  const row = rows?.find((r) => norm(r.ad_account_id) === norm(accountId)) ?? null;
  const original = row?.asana_description ?? "";
  const dirty = row != null && text !== (row.draft ?? original);
  const pending = row?.draft != null && row.draft !== original;

  const load = useCallback(async () => {
    const d = await call("GET");
    setRows((d.rows ?? []) as Row[]);
    setConfigured(d.configured !== false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as descrições ao abrir a ficha
    load().catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- o texto acompanha o cliente escolhido
    setText(row ? (row.draft ?? row.asana_description) : "");
    setMsg(null);
    setConfirm(null);
  }, [row]);

  async function buscar() {
    setBusy("buscar");
    setMsg(null);
    try {
      const d = await call("POST", { action: "sync" });
      await load();
      const s = d.summary as { updated?: string[]; errors?: string[] } | undefined;
      setMsg(s?.errors?.length ? { ok: false, text: s.errors[0] } : { ok: true, text: "Atualizado do Asana." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function enviar(force = false) {
    if (!row) return;
    setBusy("enviar");
    setMsg(null);
    try {
      if (dirty || force) await call("PATCH", { ad_account_id: row.ad_account_id, draft: text });
      const r = (await call("POST", { action: "send", ad_account_id: row.ad_account_id, force })) as { ok: boolean; code?: string; message?: string };
      if (!r.ok) {
        if (r.code === "conflict" || r.code === "rich") setConfirm(r.message ?? "Confirme o envio.");
        else setMsg({ ok: false, text: r.message ?? "Não foi possível enviar." });
      } else {
        setConfirm(null);
        setMsg({ ok: true, text: "Enviado pro Asana." });
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function descartar() {
    if (!row) return;
    setBusy("descartar");
    try {
      await call("PATCH", { ad_account_id: row.ad_account_id, draft: null });
      await load();
      setText(row.asana_description);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Descrição (Asana)</span>
        <Btn small onClick={() => void buscar()} disabled={busy != null || !configured}>{busy === "buscar" ? "Buscando…" : "↻ Buscar do Asana"}</Btn>
      </div>
      {!configured ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">Falta configurar o ASANA_ACCESS_TOKEN na Vercel.</p>
      ) : rows == null ? (
        <p className="text-xs text-zinc-500">Carregando…</p>
      ) : !row ? (
        <p className="text-xs text-zinc-500">Ainda não buscado. Clique em “Buscar do Asana”.</p>
      ) : row.match_status !== "ok" ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {row.match_status === "ambiguous"
            ? `Mais de uma tarefa no Asana parece ser “${clientName}”. Deixe o nome igual ao da tarefa.`
            : `Não achei tarefa no Asana com o nome “${clientName}”. O nome do cliente precisa ser igual ao da tarefa.`}
        </p>
      ) : (
        <>
          <textarea
            id={`desc-${norm(accountId)}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            aria-label="Descrição do cliente no Asana"
            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm leading-relaxed dark:border-white/10 dark:bg-[#141924]"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>
              {row.synced_at ? `Asana ${ago(row.synced_at)}` : ""}
              {row.asana_has_rich ? " · tem formatação no Asana" : ""}
              {pending && !dirty ? " · alteração ainda não enviada" : ""}
            </span>
            <a
              href={`https://app.asana.com/0/${PROJECT}/${row.asana_task_gid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Abrir tarefa ↗
            </a>
          </div>
          {confirm ? (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {confirm}
              <div className="mt-2 flex gap-2">
                <Btn small primary onClick={() => void enviar(true)} disabled={busy != null}>Enviar mesmo assim</Btn>
                <Btn small onClick={() => setConfirm(null)}>Cancelar</Btn>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Btn small primary onClick={() => void enviar(false)} disabled={busy != null || (!dirty && !pending)}>
              {busy === "enviar" ? "Enviando…" : "Enviar pro Asana"}
            </Btn>
            {dirty || pending ? <Btn small onClick={() => void descartar()} disabled={busy != null}>Descartar alteração</Btn> : null}
          </div>
        </>
      )}
      {msg ? <p className={`text-xs ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p> : null}
    </div>
  );
}
