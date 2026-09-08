"use client";

import { useEffect, useState } from "react";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/crm/pipeline";
import { LeadModal } from "@/components/crm/lead-modal";

interface Instance {
  id: string;
  name: string;
  public_token: string;
  sale_webhook_url: string | null;
  lead_count: number;
}

interface Lead {
  id: string;
  crm_instance_id: string;
  name: string;
  phone: string | null;
  status: string;
  source: unknown;
  created_at: string;
  updated_at: string;
}

export function CrmBoard() {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  async function loadInstances(selectAfter?: string) {
    const res = await fetch("/api/crm/instances");
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    const list = (d.instances ?? []) as Instance[];
    setInstances(list);
    if (selectAfter) {
      setSelectedId(selectAfter);
    } else if (selectedId === null && list.length > 0) {
      setSelectedId(list[0].id);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial da lista de instâncias do CRM
    void loadInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadInstances não deve rodar de novo a cada render
  }, []);

  async function loadLeads(instanceId: string) {
    setLeads(null);
    const res = await fetch(`/api/crm/leads?instance_id=${encodeURIComponent(instanceId)}`);
    const d = await res.json();
    setLeads(d.leads ?? []);
  }

  useEffect(() => {
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- busca os leads sempre que a instância selecionada muda
      void loadLeads(selectedId);
    } else {
      setLeads(null);
    }
  }, [selectedId]);

  async function createInstance() {
    const name = newInstanceName.trim();
    if (!name) return;
    setCreatingInstance(true);
    const res = await fetch("/api/crm/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json();
    setCreatingInstance(false);
    if (d.error) {
      alert(d.error);
      return;
    }
    setNewInstanceName("");
    await loadInstances(d.instance.id);
  }

  async function patchInstance(id: string, patch: { name?: string; sale_webhook_url?: string | null }) {
    setInstances((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await fetch(`/api/crm/instances/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteInstance(id: string) {
    if (!confirm("Excluir esta instância e todos os leads dela? Essa ação não pode ser desfeita.")) return;
    await fetch(`/api/crm/instances/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await loadInstances();
  }

  async function createLead() {
    if (!selectedId) return;
    const name = newLeadName.trim();
    if (!name) return;
    const res = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: selectedId, name, phone: newLeadPhone.trim() || null }),
    });
    const d = await res.json();
    if (d.error) {
      alert(d.error);
      return;
    }
    setNewLeadName("");
    setNewLeadPhone("");
    setNewLeadOpen(false);
    await loadLeads(selectedId);
    await loadInstances(selectedId);
  }

  async function moveLead(lead: Lead, status: LeadStatus) {
    setLeads((prev) => (prev ?? []).map((l) => (l.id === lead.id ? { ...l, status } : l)));
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = await res.json();
    if (d.error) {
      alert(d.error);
      if (selectedId) void loadLeads(selectedId);
    }
  }

  const selectedInstance = (instances ?? []).find((i) => i.id === selectedId) ?? null;
  const statusIndex = (s: string) => LEAD_STATUSES.findIndex((st) => st.id === s);

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>;
  }

  if (!instances) {
    return <p className="text-sm text-zinc-500">Carregando…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {instances.map((i) => (
          <button
            key={i.id}
            onClick={() => setSelectedId(i.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              selectedId === i.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {i.name} <span className="opacity-60">· {i.lead_count}</span>
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            value={newInstanceName}
            onChange={(e) => setNewInstanceName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createInstance()}
            placeholder="Nova instância…"
            className="h-8 w-40 rounded-md border border-zinc-300 bg-transparent px-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            onClick={() => void createInstance()}
            disabled={creatingInstance || !newInstanceName.trim()}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            + Criar
          </button>
        </div>
      </div>

      {instances.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhuma instância ainda — crie uma acima pra começar a receber leads.
        </p>
      ) : selectedInstance ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500 dark:text-zinc-400">Link público:</span>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/c/${selectedInstance.public_token}`);
                }}
                className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-medium dark:border-zinc-700"
                title={`${typeof window !== "undefined" ? window.location.origin : ""}/c/${selectedInstance.public_token}`}
              >
                Copiar link do cliente
              </button>
              <button onClick={() => void deleteInstance(selectedInstance.id)} className="text-xs text-zinc-400 hover:text-red-600">
                Excluir instância
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 dark:text-zinc-400">Webhook de venda (n8n):</span>
              <input
                defaultValue={selectedInstance.sale_webhook_url ?? ""}
                placeholder="https://…"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (selectedInstance.sale_webhook_url ?? "")) {
                    void patchInstance(selectedInstance.id, { sale_webhook_url: v || null });
                  }
                }}
                className="h-8 w-56 rounded-md border border-zinc-300 bg-transparent px-2 text-xs outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Ingestão automática de leads via n8n: POST em <code>/api/public/hooks/crm-lead-ingest</code> com o
              mesmo <code>public_token</code> acima.
            </p>
            <button
              onClick={() => setNewLeadOpen((o) => !o)}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
            >
              + Novo lead
            </button>
          </div>

          {newLeadOpen ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <input
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                placeholder="Nome do lead"
                className="h-8 w-48 rounded-md border border-zinc-300 bg-transparent px-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
              <input
                value={newLeadPhone}
                onChange={(e) => setNewLeadPhone(e.target.value)}
                placeholder="Telefone (opcional)"
                className="h-8 w-40 rounded-md border border-zinc-300 bg-transparent px-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
              <button
                onClick={() => void createLead()}
                disabled={!newLeadName.trim()}
                className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Adicionar
              </button>
            </div>
          ) : null}

          {!leads ? (
            <p className="text-sm text-zinc-500">Carregando leads…</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {LEAD_STATUSES.map((s) => {
                const inColumn = leads.filter((l) => l.status === s.id);
                return (
                  <div key={s.id} className="min-w-0 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        {s.label} · {inColumn.length}
                      </h3>
                    </div>
                    <div className="flex flex-col gap-2 p-2">
                      {inColumn.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-zinc-400">—</p>
                      ) : (
                        inColumn.map((l) => {
                          const idx = statusIndex(l.status);
                          return (
                            <div
                              key={l.id}
                              className="cursor-pointer rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-xs hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                              onClick={() => setSelectedLeadId(l.id)}
                            >
                              <p className="font-medium text-zinc-800 dark:text-zinc-200">{l.name}</p>
                              {l.phone ? <p className="text-zinc-500 dark:text-zinc-400">{l.phone}</p> : null}
                              <div className="mt-1.5 flex items-center justify-between">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (idx > 0) void moveLead(l, LEAD_STATUSES[idx - 1].id);
                                  }}
                                  disabled={idx <= 0}
                                  className="rounded px-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-20 dark:hover:text-zinc-200"
                                  title="Voltar estágio"
                                >
                                  ‹
                                </button>
                                <span className="text-[11px] text-zinc-400">
                                  {new Date(l.updated_at).toLocaleDateString("pt-BR")}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (idx < LEAD_STATUSES.length - 1) void moveLead(l, LEAD_STATUSES[idx + 1].id);
                                  }}
                                  disabled={idx >= LEAD_STATUSES.length - 1}
                                  className="rounded px-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-20 dark:hover:text-zinc-200"
                                  title="Avançar estágio"
                                >
                                  ›
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {selectedLeadId ? (
        <LeadModal
          leadId={selectedLeadId}
          lead={(leads ?? []).find((l) => l.id === selectedLeadId) ?? null}
          onClose={() => setSelectedLeadId(null)}
          onChanged={() => {
            if (selectedId) void loadLeads(selectedId);
          }}
          onDeleted={() => {
            setSelectedLeadId(null);
            if (selectedId) void loadLeads(selectedId);
          }}
        />
      ) : null}
    </div>
  );
}
