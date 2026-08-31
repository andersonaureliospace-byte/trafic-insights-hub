"use client";

import { useEffect, useState } from "react";
import { LEAD_STATUSES, leadStatusLabel, isLeadStatus } from "@/lib/crm/pipeline";

interface LeadSummary {
  id: string;
  name: string;
  phone: string | null;
  status: string;
}

interface Event {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

export function LeadModal({
  leadId,
  lead,
  onClose,
  onChanged,
  onDeleted,
}: {
  leadId: string;
  lead: LeadSummary | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [status, setStatus] = useState(lead?.status ?? "novo");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o estágio local quando o lead selecionado muda
    setStatus(lead?.status ?? "novo");
  }, [lead?.status]);

  async function loadEvents() {
    const res = await fetch(`/api/crm/leads/${leadId}/events`);
    const d = await res.json();
    setEvents(d.events ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial do histórico do lead ao abrir o modal
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadEvents não deve rodar de novo a cada render, só quando o lead muda
  }, [leadId]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    setSaving(false);
    if (d.error) {
      alert(d.error);
      return;
    }
    onChanged();
    await loadEvents();
  }

  async function handleDelete() {
    if (!confirm("Excluir este lead? Essa ação não pode ser desfeita.")) return;
    await fetch(`/api/crm/leads/${leadId}`, { method: "DELETE" });
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{lead?.name ?? "Lead"}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              Nome
              <input
                key={`name-${leadId}`}
                defaultValue={lead?.name ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== lead?.name) void patch({ name: v });
                }}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
            </label>
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              Telefone
              <input
                key={`phone-${leadId}`}
                defaultValue={lead?.phone ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (lead?.phone ?? "")) void patch({ phone: v || null });
                }}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
            </label>
          </div>

          <div className="mt-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Estágio</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s.id}
                  disabled={saving}
                  onClick={() => {
                    if (!isLeadStatus(s.id) || s.id === status) return;
                    setStatus(s.id);
                    void patch({ status: s.id });
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                    status === s.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {status === "venda" ? (
              <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                Ao marcar como venda, o webhook de venda da instância (se configurado) é notificado automaticamente.
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Histórico</p>
            <div className="mt-2 flex flex-col gap-2">
              {!events ? (
                <p className="text-xs text-zinc-400">Carregando…</p>
              ) : events.length === 0 ? (
                <p className="text-xs text-zinc-400">Sem eventos ainda.</p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="rounded-md border border-zinc-100 px-2.5 py-1.5 text-xs dark:border-zinc-800">
                    <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
                      <span>
                        {ev.event_type === "created"
                          ? "Lead criado"
                          : `${ev.from_status ? leadStatusLabel(ev.from_status) : "—"} → ${ev.to_status ? leadStatusLabel(ev.to_status) : "—"}`}
                      </span>
                      <span>{new Date(ev.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    {ev.note ? <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{ev.note}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button onClick={() => void handleDelete()} className="text-xs font-medium text-red-600 hover:text-red-700">
            Excluir lead
          </button>
          <button onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
