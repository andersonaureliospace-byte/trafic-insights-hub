"use client";

import { useEffect, useMemo, useState } from "react";

interface Group {
  id: string;
  name: string;
}

interface Binding {
  ad_account_id: string;
  client_name: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
}

interface Template {
  id: string;
  name: string;
  body: string;
}

interface DispatchTargetRow {
  ad_account_id: string;
  client_name: string;
  wa_group_id: string;
  wa_group_name: string;
}

interface Dispatch {
  id: string;
  message: string;
  targets: DispatchTargetRow[];
  scheduled_at: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  status: string;
  last_run_at: string | null;
  last_error: string | null;
}

interface Target {
  id: string; // wa_group_id
  name: string; // wa_group_name
  clientName: string;
}

const RECURRENCE_LABELS: Record<string, string> = {
  none: "Uma vez",
  daily: "Diariamente",
  weekly: "Semanalmente",
  monthly: "Mensalmente",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function EnvioTab() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [bindings, setBindings] = useState<Binding[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const [sendSummary, setSendSummary] = useState<{ ok: number; fail: number } | null>(null);

  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);

  async function loadGroups(force: boolean) {
    setLoadingGroups(true);
    setGroupsError(null);
    const res = await fetch("/api/whatsapp/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const d = await res.json();
    setLoadingGroups(false);
    if (d.error) {
      setGroupsError(d.error);
      return;
    }
    setGroups(d.groups ?? []);
  }

  async function loadDispatches() {
    const res = await fetch("/api/whatsapp/scheduled-dispatches");
    const d = await res.json();
    setDispatches(d.dispatches ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos grupos do WhatsApp
    void loadGroups(false);

    fetch("/api/account-bindings")
      .then((r) => r.json())
      .then((d) => setBindings(d.bindings ?? []));

    fetch("/api/whatsapp/message-templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []));

    void loadDispatches();
  }, []);

  const targets = useMemo<Target[]>(() => {
    const clientByGroup = new Map<string, string>();
    for (const b of bindings) {
      if (b.wa_group_id && b.client_name) clientByGroup.set(b.wa_group_id, b.client_name);
    }
    const list = (groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      clientName: clientByGroup.get(g.id) ?? "—",
    }));
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return list;
  }, [groups, bindings]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => t.name.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q));
  }, [targets, search]);

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) {
        for (const t of visible) n.delete(t.id);
      } else {
        for (const t of visible) n.add(t.id);
      }
      return n;
    });
  }

  const selectedTargets = useMemo(() => targets.filter((t) => selected.has(t.id)), [targets, selected]);

  async function sendNow() {
    if (selectedTargets.length === 0 || !message.trim()) return;
    setSending(true);
    setSendSummary(null);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < selectedTargets.length; i++) {
      const t = selectedTargets[i];
      const text = message.replaceAll("{cliente}", t.clientName !== "—" ? t.clientName : t.name);
      setSendProgress({ done: i, total: selectedTargets.length });
      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: t.id, text }),
        });
        const d = await res.json();
        if (d.error) fail++;
        else ok++;
      } catch {
        fail++;
      }
      if (i < selectedTargets.length - 1) {
        await sleep(1500); // pausa curta entre envios manuais — o disparo agendado usa 30-60s
      }
    }
    setSendProgress(null);
    setSending(false);
    setSendSummary({ ok, fail });
  }

  async function saveTemplate() {
    const name = window.prompt("Nome do modelo:");
    if (!name || !name.trim() || !message.trim()) return;
    const res = await fetch("/api/whatsapp/message-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), body: message }),
    });
    const d = await res.json();
    if (d.template) setTemplates((prev) => [d.template, ...(prev ?? [])]);
  }

  function loadTemplate(id: string) {
    setSelectedTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) setMessage(t.body);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Excluir esse modelo?")) return;
    await fetch("/api/whatsapp/message-templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setTemplates((prev) => (prev ?? []).filter((t) => t.id !== id));
    if (selectedTemplateId === id) setSelectedTemplateId("");
  }

  async function confirmSchedule() {
    if (selectedTargets.length === 0) {
      setScheduleError("Selecione ao menos um destinatário.");
      return;
    }
    if (!message.trim()) {
      setScheduleError("Escreva a mensagem.");
      return;
    }
    if (!scheduledAt) {
      setScheduleError("Escolha data e hora.");
      return;
    }
    setScheduling(true);
    setScheduleError(null);
    const res = await fetch("/api/whatsapp/scheduled-dispatches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        targets: selectedTargets.map((t) => ({
          ad_account_id: t.id,
          client_name: t.clientName,
          wa_group_id: t.id,
          wa_group_name: t.name,
        })),
        scheduledAt: new Date(scheduledAt).toISOString(),
        recurrence,
      }),
    });
    const d = await res.json();
    setScheduling(false);
    if (d.error) {
      setScheduleError(d.error);
      return;
    }
    setScheduleOpen(false);
    setScheduledAt("");
    setRecurrence("none");
    void loadDispatches();
  }

  async function cancelDispatch(id: string) {
    if (!confirm("Cancelar esse agendamento?")) return;
    await fetch("/api/whatsapp/scheduled-dispatches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void loadDispatches();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Mensagem</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => loadTemplate(e.target.value)}
                className="h-8 max-w-[160px] rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
              >
                <option value="">Modelos…</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedTemplateId ? (
                <button onClick={() => void deleteTemplate(selectedTemplateId)} className="text-xs font-medium text-red-600">
                  Excluir modelo
                </button>
              ) : null}
              <button
                onClick={() => void saveTemplate()}
                className="h-8 rounded-md border border-zinc-300 px-2 text-xs font-medium dark:border-zinc-700"
              >
                Salvar como modelo
              </button>
            </div>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={4096}
            placeholder="Escreva a mensagem… use {cliente} pra puxar o nome do cliente de cada grupo."
            className="mt-2 w-full resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{"{cliente}"} vira o nome cadastrado no Painel (ou o nome do grupo, se não houver vínculo).</span>
            <span>{message.length}/4096</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void sendNow()}
              disabled={sending || selectedTargets.length === 0 || !message.trim()}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {sending
                ? `Enviando… ${sendProgress ? `${sendProgress.done}/${sendProgress.total}` : ""}`
                : `Enviar agora (${selectedTargets.length})`}
            </button>
            <button
              onClick={() => setScheduleOpen(true)}
              disabled={selectedTargets.length === 0 || !message.trim()}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
            >
              Agendar
            </button>
            {sendSummary ? (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {sendSummary.ok} enviada(s){sendSummary.fail > 0 ? `, ${sendSummary.fail} falharam` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Agendados</h2>
          </div>
          {dispatches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum disparo agendado.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {dispatches.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{d.message}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(d.scheduled_at).toLocaleString("pt-BR")} · {RECURRENCE_LABELS[d.recurrence]} ·{" "}
                      {d.targets.length} destinatário(s) · {d.status}
                      {d.last_error ? ` · erro: ${d.last_error}` : ""}
                    </p>
                  </div>
                  <button onClick={() => void cancelDispatch(d.id)} className="shrink-0 text-xs font-medium text-red-600">
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Destinatários</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou grupo…"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="size-3.5" />
              Selecionar todos
            </label>
            <button
              onClick={() => void loadGroups(true)}
              disabled={loadingGroups}
              className="font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
            >
              {loadingGroups ? "Atualizando…" : "Atualizar grupos"}
            </button>
          </div>
        </div>
        <div className="max-h-[480px] overflow-y-auto px-2 py-2">
          {groupsError ? (
            <p className="px-3 py-4 text-sm text-red-600">{groupsError}</p>
          ) : !groups ? (
            <p className="px-3 py-4 text-sm text-zinc-500">Carregando grupos…</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-500">Nenhum grupo encontrado.</p>
          ) : (
            visible.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="size-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t.clientName !== "—" ? t.clientName : t.name}</span>
                  {t.clientName !== "—" ? <span className="block truncate text-xs text-zinc-400">{t.name}</span> : null}
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      {scheduleOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setScheduleOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Agendar envio</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {selectedTargets.length} destinatário(s) selecionado(s).
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Data e hora</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Recorrência</label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              >
                <option value="none">Uma vez</option>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente (mesmo dia da semana)</option>
                <option value="monthly">Mensalmente (mesmo dia do mês)</option>
              </select>
            </div>
            {scheduleError ? <p className="mt-3 text-sm text-red-600">{scheduleError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setScheduleOpen(false)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmSchedule()}
                disabled={scheduling}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {scheduling ? "Agendando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
