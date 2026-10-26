"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AUTOMATION_LABELS } from "@/lib/automation-labels";

interface AlertNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  item_count: number;
  sent_to_group: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// Etapa 190: uma rodada de automação (tabela automation_runs) — inclusive as que não mexeram em nada.
interface AutomationRun {
  id: string;
  automation: string;
  status: "changed" | "no-change" | "error";
  summary: string;
  details: { alerts?: Array<{ kind: string; title: string; count: number }>; mode?: string } | null;
  started_at: string;
  finished_at: string;
}
const RUN_STATUS: Record<AutomationRun["status"], { label: string; badge: string; accent: string }> = {
  changed: {
    label: "Mexeu em algo",
    badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    accent: "border-l-amber-400",
  },
  "no-change": {
    label: "Sem alteração",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    accent: "border-l-emerald-500",
  },
  error: { label: "Erro", badge: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300", accent: "border-l-red-500" },
};
function clock(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Rótulo curto de cada tipo (o título completo vem da própria notificação).
const KIND_LABELS: Record<string, string> = {
  "creatives-pause": "Criativos pausados",
  "creatives-no-result": "Criativos sem resultado",
  "adsets-paused": "Conjuntos pausados",
  "adsets-cut": "Orçamento reduzido",
  "adsets-cut-failed": "Corte não aplicado",
  "low-budget": "Invest. diário ≤ 55% do Ritmo",
  "low-investment": "Investimento baixo",
  "cpa-yesterday": "CPA acima da meta (ontem)",
  "cpa-today": "CPA acima da meta (hoje)",
  "bulk-status": "Prioridade em massa",
  "balance-low": "Saldo baixo",
  "balance-friday": "Saldo de sexta",
  "balance-evening": "Saldo para amanhã (19h)",
  "payment-error": "Erro no pagamento",
  "morning-summary": "Resumo das 7h",
  "no-delivery": "Conta sem entrega",
  "budget-increase": "Aumento de investimento",
  "naming-fix": "Ajuste de nomes",
  "adsets-no-spend": "Conjunto sem gasto",
  "pause-backup": "Reativado (backup)",
  "weekend-standby": "Standby de fim de semana",
  "exam-missing": "Sem exame ativo",
  "audit-location": "Localização dos conjuntos",
  "audit-errors": "Erros de veiculação",
};

// Cor da barrinha da esquerda: vermelho = o que também vai pro grupo (urgente); âmbar = o resto.
function accentClass(n: AlertNotification): string {
  return n.sent_to_group ? "border-l-red-500" : "border-l-amber-400";
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

function expiresIn(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "vencendo";
  const h = Math.ceil(mins / 60);
  return h >= 24 ? `some em ${Math.round(h / 24)} d` : `some em ${h} h`;
}

// Aba Alertas (Etapa 112) — todas as notificações das verificações automáticas. No grupo do
// WhatsApp vão só as urgentes; aqui aparece tudo. Some em 72h ou quando clica em OK.
// Etapa 135: sem selo vermelho no menu; filtros por CONTA e por JANELA DE TEMPO (data e hora) aqui dentro mesmo.
// Filtro por conta: a notificação cita o nome do cliente no título/texto — procura o nome ali (sem confundir
// "IVS CHAPECÓ" com "IVS CHAPECÓ 2": depois do nome não pode vir letra, número nem " 2").
function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function mentionsAccount(n: AlertNotification, name: string): boolean {
  const hay = norm(`${n.title}\n${n.body}`);
  const needle = norm(name).trim();
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const rest = hay.slice(i + needle.length);
    if (!/^(\s?\d|[a-z0-9])/.test(rest)) return true;
    from = i + 1;
  }
}
// "2026-10-17T07:00" (hora local do navegador) pra comparar com a data do alerta.
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AlertasTab({ accountNames = [] }: { accountNames?: string[] }) {
  const [items, setItems] = useState<AlertNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todos" | "grupo" | "painel">("todos");
  // Etapa 190: "Alertas" (notificações abertas) ou "Registro" (toda rodada das automações, até sem alteração).
  const [view, setView] = useState<"alertas" | "registro">("alertas");
  const [automation, setAutomation] = useState("");
  const [runStatus, setRunStatus] = useState<"todos" | AutomationRun["status"]>("todos");
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Nomes dos clientes vêm direto do banco (rápido). Antes dependiam da lista da Meta, que demora e deixava o filtro vazio.
  const [boundNames, setBoundNames] = useState<string[]>([]);
  // Etapa 206: id + nome das contas ativas (botão "Verificar criativos de uma conta" do Registro).
  const [boundAccounts, setBoundAccounts] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/account-bindings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { bindings?: Array<{ ad_account_id?: string; client_name?: string | null; active?: boolean | null }> }) => {
        const list = (d.bindings ?? []).filter((b) => b.active !== false && b.client_name && b.client_name.trim());
        setBoundNames(list.map((b) => (b.client_name as string).trim()));
        setBoundAccounts(
          list
            .filter((b) => b.ad_account_id)
            .map((b) => ({ id: b.ad_account_id as string, name: (b.client_name as string).trim() }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        );
      })
      .catch(() => {});
  }, []);
  const [diagAccount, setDiagAccount] = useState("");
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<
    | { error: string }
    | { paused: number; diag: Array<{ client_name: string; cpa_target: number; error: string | null; retried: boolean; notes: string[] }> }
    | null
  >(null);
  async function runDiag() {
    if (!diagAccount) return;
    setDiagBusy(true);
    setDiagResult(null);
    try {
      const res = await fetch("/api/alerts/creatives-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: diagAccount }),
      });
      const d = await res.json();
      if (d.error) setDiagResult({ error: d.error });
      else setDiagResult({ paused: ((d.paused ?? []) as Array<{ ok: boolean }>).filter((p) => p.ok).length, diag: d.diag ?? [] });
    } catch (e) {
      setDiagResult({ error: (e as Error).message });
    } finally {
      setDiagBusy(false);
    }
  }
  const accountOptions = useMemo(
    () => [...new Set([...accountNames, ...boundNames])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [accountNames, boundNames],
  );

  function quick(kind: "1h" | "24h" | "hoje" | "ontem") {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === "1h") {
      setFrom(localInput(new Date(now.getTime() - 3_600_000)));
      setTo("");
    } else if (kind === "24h") {
      setFrom(localInput(new Date(now.getTime() - 24 * 3_600_000)));
      setTo("");
    } else if (kind === "hoje") {
      setFrom(localInput(startOfToday));
      setTo("");
    } else {
      setFrom(localInput(new Date(startOfToday.getTime() - 24 * 3_600_000)));
      setTo(localInput(new Date(startOfToday.getTime() - 60_000)));
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/alerts/notifications", { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      const list = (d.notifications ?? []) as AlertNotification[];
      setItems(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os alertas assim que a aba monta
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const loadRuns = useCallback(async () => {
    setRunsError(null);
    const q = new URLSearchParams();
    if (automation) q.set("automation", automation);
    if (runStatus !== "todos") q.set("status", runStatus);
    if (from) q.set("from", new Date(from).toISOString());
    if (to) q.set("to", new Date(new Date(to).getTime() + 59_999).toISOString());
    try {
      const res = await fetch(`/api/automation-runs?${q.toString()}`, { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setRunsError(d.error);
        setRuns([]);
        return;
      }
      setRuns((d.runs ?? []) as AutomationRun[]);
    } catch (e) {
      setRunsError((e as Error).message);
    }
  }, [automation, runStatus, from, to]);

  useEffect(() => {
    if (view !== "registro") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o registro ao abrir/mudar filtro
    void loadRuns();
    const t = setInterval(() => void loadRuns(), 60_000);
    return () => clearInterval(t);
  }, [view, loadRuns]);

  async function ok(id: string) {
    setItems((prev) => (prev ?? []).filter((n) => n.id !== id));
    await fetch(`/api/alerts/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function okAll() {
    if (!confirm("Dar OK em todos os alertas? Eles serão apagados.")) return;
    setItems([]);
    await fetch("/api/alerts/notifications?all=1", { method: "DELETE" });
  }

  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() + 59_999 : null;
  const shown = (items ?? []).filter((n) => {
    if (filter === "grupo" && !n.sent_to_group) return false;
    if (filter === "painel" && n.sent_to_group) return false;
    const t = new Date(n.updated_at).getTime();
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    if (account && !mentionsAccount(n, account)) return false;
    if (automation && n.kind !== automation) return false;
    return true;
  });
  const shownRuns = (runs ?? []).filter(
    (r) => !account || mentionsAccount({ title: r.summary, body: (r.details?.alerts ?? []).map((a) => a.title).join("\n") } as AlertNotification, account),
  );
  const hasFilters = !!(account || from || to || automation);
  // Opções do filtro "Automação": no Alertas = tipos de alerta; no Registro = automações.
  const automationOptions = Object.entries(view === "alertas" ? KIND_LABELS : AUTOMATION_LABELS).sort((a, b) =>
    a[1].localeCompare(b[1], "pt-BR"),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          {(["alertas", "registro"] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                setAutomation("");
              }}
              className={`text-sm font-semibold ${
                view === v ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              {v === "alertas" ? "Alertas" : "Registro das automações"}
            </button>
          ))}
          <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          {view === "registro"
            ? (["todos", "changed", "no-change", "error"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setRunStatus(f)}
                  className={`h-7 rounded-full px-2.5 text-xs font-medium ${
                    runStatus === f
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {f === "todos" ? "Todas" : RUN_STATUS[f].label}
                </button>
              ))
            : null}
          {view === "alertas" && (["todos", "grupo", "painel"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-7 rounded-full px-2.5 text-xs font-medium ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {f === "todos" ? "Todos" : f === "grupo" ? "Urgentes (foram pro grupo)" : "Só aqui"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void (view === "alertas" ? load() : loadRuns())}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
          >
            ↻ Atualizar
          </button>
          <button
            onClick={() => void okAll()}
            disabled={!items || items.length === 0}
            hidden={view === "registro"}
            className="h-8 rounded-md bg-zinc-900 px-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            OK em todos
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 text-xs dark:border-zinc-800/60">
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className="h-8 max-w-[240px] rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Filtrar por conta"
        >
          <option value="">Todas as contas</option>
          {accountOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={automation}
          onChange={(e) => setAutomation(e.target.value)}
          className="h-8 max-w-[260px] rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Filtrar por automação"
        >
          <option value="">Todas as automações</option>
          {automationOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          De
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          até
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {(["1h", "24h", "hoje", "ontem"] as const).map((k) => (
          <button
            key={k}
            onClick={() => quick(k)}
            className="h-7 rounded-full border border-zinc-300 px-2.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {k === "1h" ? "Última hora" : k === "24h" ? "Últimas 24h" : k === "hoje" ? "Hoje" : "Ontem"}
          </button>
        ))}
        {hasFilters ? (
          <button
            onClick={() => {
              setAccount("");
              setFrom("");
              setTo("");
              setAutomation("");
            }}
            className="h-7 rounded-full px-2.5 font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Limpar filtros
          </button>
        ) : null}
        {hasFilters && items && view === "alertas" ? (
          <span className="text-zinc-500 dark:text-zinc-400">
            {shown.length} de {items.length}
          </span>
        ) : null}
      </div>

      {view === "registro" ? (
        <>
          {/* Etapa 206: força a pausa de criativos numa conta só e mostra o porquê de cada criativo. */}
          <div className="space-y-2 border-b border-zinc-100 px-4 py-2 text-xs dark:border-zinc-800/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Verificar criativos de uma conta:</span>
              <select
                value={diagAccount}
                onChange={(e) => setDiagAccount(e.target.value)}
                className="h-8 max-w-[260px] rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">Escolha a conta…</option>
                {boundAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void runDiag()}
                disabled={!diagAccount || diagBusy}
                title="Roda agora a pausa automática de criativos só nesta conta (pausa de verdade o que estiver na regra) e mostra o motivo de cada criativo."
                className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {diagBusy ? "Verificando…" : "Verificar e pausar agora"}
              </button>
            </div>
            {diagResult && "error" in diagResult ? <p className="text-red-600 dark:text-red-400">{diagResult.error}</p> : null}
            {diagResult && "diag" in diagResult ? (
              diagResult.diag.length === 0 ? (
                <p className="text-zinc-500">Conta fora da varredura (sem CPA ideal cadastrado, desativada ou fora das contas exibidas).</p>
              ) : (
                diagResult.diag.map((x, i) => (
                  <div key={i} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-950">
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      {x.client_name} · CPA ideal {x.cpa_target.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {diagResult.paused} pausado(s)
                      {x.retried ? " · a Meta falhou na 1ª tentativa" : ""}
                    </p>
                    {x.error ? <p className="text-red-600 dark:text-red-400">Não deu pra verificar: {x.error}</p> : null}
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-600 dark:text-zinc-400">
                      {x.notes.map((n, j) => (
                        <li key={j}>{n}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )
            ) : null}
          </div>
          <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
            Toda vez que uma automação roda fica um registro aqui — inclusive quando ela verificou e não precisou mexer em
            nada. Verde = sem alteração, âmbar = mexeu em algo (gerou alerta), vermelho = deu erro. Fica guardado por 30 dias.
          </p>
          {runsError ? <p className="px-4 py-3 text-sm text-red-600">{runsError}</p> : null}
          {runs === null && !runsError ? <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p> : null}
          {runs !== null && shownRuns.length === 0 && !runsError ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">Nenhuma rodada registrada com esses filtros.</p>
          ) : null}
          {runs !== null && shownRuns.length > 0 ? (
            <p className="border-b border-zinc-100 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
              {shownRuns.length} rodada{shownRuns.length === 1 ? "" : "s"} ·{" "}
              {shownRuns.filter((r) => r.status === "no-change").length} sem alteração ·{" "}
              {shownRuns.filter((r) => r.status === "changed").length} mexeram em algo ·{" "}
              {shownRuns.filter((r) => r.status === "error").length} com erro
            </p>
          ) : null}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {shownRuns.map((r) => (
              <li key={r.id} className={`border-l-4 px-4 py-2.5 ${RUN_STATUS[r.status].accent}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {AUTOMATION_LABELS[r.automation] ?? r.automation}
                    {r.details?.mode ? ` · ${r.details.mode}` : ""}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 font-medium ${RUN_STATUS[r.status].badge}`}>{RUN_STATUS[r.status].label}</span>
                  <span title={`Começou ${clock(r.started_at)} · terminou ${clock(r.finished_at)}`}>
                    {clock(r.started_at)} · {ago(r.started_at)}
                  </span>
                </div>
                {r.status === "changed" && r.details?.alerts?.length ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-zinc-800 dark:text-zinc-200">
                    {r.details.alerts.map((a, i) => (
                      <li key={i}>{a.title}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={`mt-1 text-sm ${r.status === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                    {r.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
      <>
      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Aqui aparecem todas as notificações das verificações automáticas. No grupo do WhatsApp vão só as urgentes
        (CPA acima da meta, Invest. diário em 55% do Ritmo, saldo baixo, saldo de sexta, erro no pagamento e erros de veiculação). Cada
        alerta some sozinho em 72 horas ou quando você clica em OK.
      </p>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {items === null && !error ? <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p> : null}
      {items !== null && shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">
          {hasFilters ? "Nenhum alerta com esses filtros." : "Nenhum alerta aberto. Tudo certo por aqui."}
        </p>
      ) : null}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {shown.map((n) => (
          <li key={n.id} className={`border-l-4 px-4 py-3 ${accentClass(n)}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {KIND_LABELS[n.kind] ?? n.kind}
                  </span>
                  {n.sent_to_group ? (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      enviado ao grupo
                    </span>
                  ) : null}
                  <span>{ago(n.updated_at)}</span>
                  <span>· {expiresIn(n.expires_at)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{n.title}</p>
                {n.body ? (
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-700 dark:text-zinc-300">{n.body}</pre>
                ) : null}
              </div>
              <button
                onClick={() => void ok(n.id)}
                className="h-8 shrink-0 rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                OK
              </button>
            </div>
          </li>
        ))}
      </ul>
      </>
      )}
    </div>
  );
}
