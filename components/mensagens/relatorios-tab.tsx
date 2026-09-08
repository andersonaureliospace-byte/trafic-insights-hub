"use client";

import { useEffect, useMemo, useState } from "react";
import { DATE_PRESETS } from "@/lib/format";

interface AccountOption {
  id: string;
  name: string;
  clientName: string;
}

interface Group {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  body: string;
  period_preset: string;
}

interface ScheduledReport {
  id: string;
  template_id: string;
  ad_account_ids: string[];
  wa_group_id: string;
  wa_group_name: string;
  recurrence: "daily" | "weekly" | "monthly";
  next_run_at: string;
  paused: boolean;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Diariamente",
  weekly: "Semanalmente",
  monthly: "Mensalmente",
};

const VARIABLES = [
  { key: "cliente", desc: "nome do cliente" },
  { key: "periodo", desc: "período do relatório" },
  { key: "investido", desc: "valor investido" },
  { key: "resultados", desc: "número de resultados" },
  { key: "cpa", desc: "CPA do período" },
  { key: "meta_cpa", desc: "meta de CPA cadastrada" },
  { key: "invest_mensal", desc: "investimento mensal combinado" },
];

export function RelatoriosTab() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);

  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [newTemplatePeriod, setNewTemplatePeriod] = useState("yesterday");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [scheduleTemplateId, setScheduleTemplateId] = useState("");
  const [scheduleGroupId, setScheduleGroupId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "monthly">("daily");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  async function loadAccounts() {
    const [selRes, accRes, bindRes] = await Promise.all([
      fetch("/api/selected-accounts").then((r) => r.json()),
      fetch("/api/meta/accounts").then((r) => r.json()),
      fetch("/api/account-bindings").then((r) => r.json()),
    ]);
    const selectedIds = new Set<string>(selRes.accountIds ?? []);
    const clientByAccount = new Map<string, string>();
    for (const b of bindRes.bindings ?? []) {
      if (b.client_name) clientByAccount.set(b.ad_account_id, b.client_name);
    }
    const list: AccountOption[] = (accRes.accounts ?? [])
      .filter((a: { account_id: string }) => selectedIds.has(a.account_id))
      .map((a: { account_id: string; name: string }) => ({
        id: a.account_id,
        name: a.name,
        clientName: clientByAccount.get(a.account_id) ?? a.name,
      }));
    list.sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
    setAccounts(list);
  }

  async function loadGroups(force: boolean) {
    setGroupsError(null);
    const res = await fetch("/api/whatsapp/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const d = await res.json();
    if (d.error) {
      setGroupsError(d.error);
      return;
    }
    setGroups(d.groups ?? []);
  }

  async function loadTemplates() {
    const res = await fetch("/api/reports/templates");
    const d = await res.json();
    setTemplates(d.templates ?? []);
  }

  async function loadScheduled() {
    const res = await fetch("/api/reports/scheduled");
    const d = await res.json();
    setScheduled(d.reports ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados da aba de Relatórios
    void loadAccounts();
    void loadGroups(false);
    void loadTemplates();
    void loadScheduled();
  }, []);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.clientName])), [accounts]);

  async function createTemplate() {
    const name = newTemplateName.trim();
    const body = newTemplateBody.trim();
    if (!name || !body) return;
    setSavingTemplate(true);
    const res = await fetch("/api/reports/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body, period_preset: newTemplatePeriod }),
    });
    const d = await res.json();
    setSavingTemplate(false);
    if (d.error) {
      alert(d.error);
      return;
    }
    setNewTemplateName("");
    setNewTemplateBody("");
    setTemplates((prev) => [d.template, ...(prev ?? [])]);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Excluir esse modelo? Relatórios agendados que usam ele vão parar de funcionar.")) return;
    await fetch("/api/reports/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setTemplates((prev) => (prev ?? []).filter((t) => t.id !== id));
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function createSchedule() {
    setScheduleError(null);
    if (!scheduleTemplateId) return setScheduleError("Selecione um modelo.");
    if (selectedAccountIds.size === 0) return setScheduleError("Selecione ao menos uma conta.");
    if (!scheduleGroupId) return setScheduleError("Selecione o grupo do WhatsApp.");
    if (!scheduledAt) return setScheduleError("Escolha a data/hora do primeiro envio.");

    const group = (groups ?? []).find((g) => g.id === scheduleGroupId);
    setScheduling(true);
    const res = await fetch("/api/reports/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: scheduleTemplateId,
        ad_account_ids: Array.from(selectedAccountIds),
        wa_group_id: scheduleGroupId,
        wa_group_name: group?.name ?? "",
        recurrence,
        scheduledAt: new Date(scheduledAt).toISOString(),
      }),
    });
    const d = await res.json();
    setScheduling(false);
    if (d.error) {
      setScheduleError(d.error);
      return;
    }
    setSelectedAccountIds(new Set());
    setScheduledAt("");
    await loadScheduled();
  }

  async function togglePause(report: ScheduledReport) {
    setScheduled((prev) => prev.map((r) => (r.id === report.id ? { ...r, paused: !r.paused } : r)));
    await fetch("/api/reports/scheduled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: report.id, paused: !report.paused }),
    });
  }

  async function deleteSchedule(id: string) {
    if (!confirm("Excluir este relatório agendado?")) return;
    await fetch("/api/reports/scheduled", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setScheduled((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Modelos de relatório</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Variáveis disponíveis:{" "}
          {VARIABLES.map((v) => (
            <code key={v.key} title={v.desc} className="mr-1 rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">
              {`{${v.key}}`}
            </code>
          ))}
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="Nome do modelo"
              className="h-9 w-56 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            />
            <select
              value={newTemplatePeriod}
              onChange={(e) => setNewTemplatePeriod(e.target.value)}
              className="h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={newTemplateBody}
            onChange={(e) => setNewTemplateBody(e.target.value)}
            rows={4}
            placeholder={"Ex.: Relatório de {cliente} ({periodo})\nInvestido: {investido}\nResultados: {resultados}\nCPA: {cpa} (meta: {meta_cpa})"}
            className="rounded-md border border-zinc-300 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            onClick={() => void createTemplate()}
            disabled={savingTemplate || !newTemplateName.trim() || !newTemplateBody.trim()}
            className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {savingTemplate ? "Salvando…" : "Salvar modelo"}
          </button>
        </div>

        {templates && templates.length > 0 ? (
          <div className="mt-4 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  {t.name} <span className="text-xs text-zinc-400">· {DATE_PRESETS.find((p) => p.id === t.period_preset)?.label ?? t.period_preset}</span>
                </span>
                <button onClick={() => void deleteTemplate(t.id)} className="shrink-0 text-xs text-zinc-400 hover:text-red-600">
                  Excluir
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Novo agendamento</h3>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Modelo
            <select
              value={scheduleTemplateId}
              onChange={(e) => setScheduleTemplateId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            >
              <option value="">Selecione…</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Grupo do WhatsApp
            {groupsError ? (
              <p className="mt-1 text-xs text-red-600">{groupsError}</p>
            ) : (
              <select
                value={scheduleGroupId}
                onChange={(e) => setScheduleGroupId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
              >
                <option value="">Selecione…</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        <div className="mt-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Contas incluídas no relatório</p>
          <div className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            {accounts.length === 0 ? (
              <p className="px-1 py-2 text-xs text-zinc-400">Nenhuma conta selecionada no Painel ainda.</p>
            ) : (
              accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <input type="checkbox" checked={selectedAccountIds.has(a.id)} onChange={() => toggleAccount(a.id)} />
                  {a.clientName}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Primeiro envio (data/hora)
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            />
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Recorrência
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}
              className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            >
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente (mesmo dia da semana)</option>
              <option value="monthly">Mensalmente (mesmo dia do mês)</option>
            </select>
          </label>
        </div>

        {scheduleError ? <p className="mt-2 text-sm text-red-600">{scheduleError}</p> : null}

        <button
          onClick={() => void createSchedule()}
          disabled={scheduling}
          className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {scheduling ? "Agendando…" : "Agendar relatório"}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Relatórios agendados</h3>
        </div>
        {scheduled.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Nenhum relatório agendado ainda.</p>
        ) : (
          <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {scheduled.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="text-zinc-800 dark:text-zinc-200">
                    {templates?.find((t) => t.id === r.template_id)?.name ?? "Modelo excluído"} → {r.wa_group_name}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {r.ad_account_ids.map((id) => accountNameById.get(id) ?? id).join(", ")} ·{" "}
                    {RECURRENCE_LABELS[r.recurrence]} · próximo em {new Date(r.next_run_at).toLocaleString("pt-BR")}
                    {r.paused ? " · pausado" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void togglePause(r)}
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
                  >
                    {r.paused ? "Retomar" : "Pausar"}
                  </button>
                  <button onClick={() => void deleteSchedule(r.id)} className="text-xs text-zinc-400 hover:text-red-600">
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
