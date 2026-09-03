"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount, AccountInsight } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency, fmtCurrencySigned, type PresetId } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { ContasExibidasDialog } from "@/components/painel/contas-exibidas-dialog";
import { ControleSaldo } from "@/components/painel/controle-saldo";
import { VisaoGeral } from "@/components/painel/visao-geral";
import { AnaliseTab } from "@/components/painel/analise-tab";
import { ClientesTab } from "@/components/painel/clientes-tab";
import { EvolucaoTab } from "@/components/painel/evolucao-tab";
import { FocusGroupsBar, type FocusGroup } from "@/components/painel/focus-groups-bar";
import { BulkStatusDialog } from "@/components/painel/bulk-status-dialog";
import { EditClientDialog } from "@/components/painel/edit-client-dialog";
import { InlineNumber } from "@/components/painel/inline-number";

interface AccountBinding {
  ad_account_id: string;
  client_name: string | null;
  cpa_target: number | null;
  monthly_investment: number | null;
  daily_investment_target: number | null;
  priority: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
  meta_leads: number | null;
  whatsapp_contact: string | null;
  address: string | null;
  sort_order: number | null;
}

// Base usada tanto no patch otimista de um campo quanto na reordenação em
// massa (drag-and-drop) — evita repetir os defaults dos dois lugares.
function defaultBinding(accountId: string): AccountBinding {
  return {
    ad_account_id: accountId,
    client_name: null,
    cpa_target: null,
    monthly_investment: null,
    daily_investment_target: null,
    priority: null,
    wa_group_id: null,
    wa_group_name: null,
    meta_leads: null,
    whatsapp_contact: null,
    address: null,
    sort_order: null,
  };
}

interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  notes: string | null;
  alert_threshold: number | null;
}

type BindingPatch = Partial<Omit<AccountBinding, "ad_account_id">>;
type PixPatch = Partial<Omit<PixRow, "ad_account_id">>;

// Chave de ordenação da tabela de Acompanhamento: quem já foi arrastado
// manualmente usa sort_order (crescente); quem nunca foi mexido cai pro
// final, ordenado por gasto (maior gasto primeiro) — igual ao comportamento
// antigo. Função pura fora do componente + comparador de uma expressão só
// pro React Compiler conseguir preservar a memoização do useMemo abaixo.
function rowSortKey(row: { binding?: AccountBinding; insight?: AccountInsight }): number {
  return row.binding?.sort_order ?? (1_000_000_000 - (row.insight?.spend ?? 0));
}

// Ritmo (Acompanhamento): quanto falta investir por dia, dos dias que
// restam no mês (incluindo hoje), pra bater a meta de Investimento mensal.
// Mês sempre considerado com 30 dias, por pedido — não os 28-31 reais do
// calendário. Sem Investimento mensal cadastrado, não dá pra calcular.
function ritmo(monthlyInvestment: number | null | undefined, spentThisMonth: number | undefined): number | null {
  if (monthlyInvestment == null) return null;
  const dayOfMonth = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", day: "numeric" }).format(new Date()),
  );
  const remainingDays = Math.max(30 - dayOfMonth + 1, 1); // hoje conta como 1 dos dias restantes
  return (monthlyInvestment - (spentThisMonth ?? 0)) / remainingDays;
}

// Cor do Ritmo: compara o quanto precisa investir por dia daqui pra frente
// (Ritmo) com o orçamento diário JÁ configurado na conta (coluna "Invest.
// diário" — orçamento atual dos conjuntos/campanhas ativos, não muda com o
// período escolhido no filtro). ⚠️ Suposição: "10 reais para cima/para
// baixo" do pedido foi interpretado como a diferença entre Ritmo e esse
// orçamento diário atual (não Ritmo comparado a zero) — é a leitura que faz
// sentido pra sinalizar se o orçamento diário já configurado está
// acima/abaixo do necessário pra bater a meta do mês. Ajustável se não for
// essa a leitura certa.
// - diferença dentro de ±10: orçamento diário já está no ritmo certo → verde
// - Ritmo mais de 10 reais ACIMA do orçamento diário atual ("pra cima"):
//   precisaria investir mais do que está configurado → laranja
// - Ritmo mais de 10 reais ABAIXO do orçamento diário atual ("pra baixo"):
//   o orçamento atual está investindo mais rápido do que precisa → vermelho
const RITMO_BAND = 10;
function ritmoColorClass(rowRitmo: number | null, dailyBudget: number | undefined): string {
  if (rowRitmo == null) return "";
  const diff = rowRitmo - (dailyBudget ?? 0);
  if (diff > RITMO_BAND) return "text-orange-600 dark:text-orange-400";
  if (diff < -RITMO_BAND) return "text-red-600 dark:text-red-400";
  return "text-emerald-600 dark:text-emerald-400";
}

// Cor da coluna CPA (Acompanhamento): compara o CPA real com o CPA ideal
// cadastrado do cliente — diferença = CPA − CPA ideal.
// - diferença negativa (CPA abaixo do ideal) → verde
// - diferença de 0 até R$1,40 acima do ideal → laranja
// - diferença acima de R$1,40 do ideal → vermelho
const CPA_ORANGE_BAND = 1.4;
function cpaDiffColorClass(diff: number | null): string {
  if (diff == null) return "";
  if (diff < 0) return "text-emerald-600 dark:text-emerald-400";
  if (diff <= CPA_ORANGE_BAND) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

// Subgrupos na lateral — cada um só busca dados do Meta (o que pesa nas
// requisições) enquanto estiver ativo. Trocar de aba não deixa nada
// "grudado" buscando em segundo plano.
// A aba "Geral" (KPIs soltos, redundante com "Visão Geral") foi removida a
// pedido — por isso a aba inicial agora é "Visão Geral".
const TABS = [
  { id: "acompanhamento", label: "Acompanhamento" },
  { id: "evolucao", label: "Evolução" },
  { id: "clientes", label: "Clientes" },
  { id: "saldo", label: "Controle de Saldo" },
  { id: "visao-geral", label: "Visão Geral" },
  { id: "analise", label: "Análise" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PainelPage() {
  const { options: priorityOptions } = usePriorityOptions();
  const [tab, setTab] = useState<TabId>("visao-geral");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [allAccounts, setAllAccounts] = useState<AdAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, AccountBinding>>({});
  const [pixAccounts, setPixAccounts] = useState<Record<string, PixRow>>({});
  const [insights, setInsights] = useState<Record<string, AccountInsight>>({});
  const [monthlyInsights, setMonthlyInsights] = useState<Record<string, AccountInsight>>({});
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [preset, setPreset] = useState<PresetId>("last_7d");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 3 filtros novos de Acompanhamento — todos começam fixos em "Todos" (sem
  // filtrar nada) até o usuário escolher outra opção.
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [cpaFilter, setCpaFilter] = useState<"all" | "high">("all");
  const [investFilter, setInvestFilter] = useState<"all" | "low" | "high">("all");
  const [focusGroups, setFocusGroups] = useState<FocusGroup[]>([]);
  const [activeFocusGroupId, setActiveFocusGroupId] = useState<string | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Contas do Meta (nome, status, saldo/teto de gasto, tipo de negócio) —
  // é o que alimenta Controle de Saldo. Função à parte (não só um efeito)
  // pra dar pra chamar de novo pelo botão "Atualizar" sem precisar dar F5.
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    const res = await fetch("/api/meta/accounts");
    const d = await res.json();
    setLoadingAccounts(false);
    if (d.error) setAccountsError(d.error);
    else {
      setAccountsError(null);
      setAllAccounts(d.accounts ?? []);
    }
  }, []);

  // Carrega seleção, contas do Meta (1 chamada só) e vínculos/PIX (Supabase,
  // barato) de cara — o que é pesado de verdade (insights/breakdown/análise
  // do Meta) só é buscado quando a aba correspondente está ativa, mais
  // abaixo.
  useEffect(() => {
    fetch("/api/selected-accounts")
      .then((r) => r.json())
      .then((d) => setSelectedIds(d.accountIds ?? []));

    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca as contas do Meta ao montar; o mesmo loadAccounts é reusado pelo botão "Atualizar" de Controle de Saldo/Clientes
    void loadAccounts();

    fetch("/api/account-bindings")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, AccountBinding> = {};
        for (const b of d.bindings ?? []) map[b.ad_account_id] = b;
        setBindings(map);
      });

    fetch("/api/pix-accounts")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, PixRow> = {};
        for (const p of d.pixAccounts ?? []) map[p.ad_account_id] = p;
        setPixAccounts(map);
      });

    fetch("/api/focus-groups")
      .then((r) => r.json())
      .then((d) => setFocusGroups(d.groups ?? []));
  }, [loadAccounts]);

  async function saveFocusGroups(groups: FocusGroup[]) {
    setFocusGroups(groups);
    await fetch("/api/focus-groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    });
  }

  const selectedAccounts = useMemo(() => {
    if (!allAccounts || !selectedIds) return [];
    const set = new Set(selectedIds);
    return allAccounts.filter((a) => set.has(a.account_id));
  }, [allAccounts, selectedIds]);

  const loadInsights = useCallback(async () => {
    if (selectedAccounts.length === 0) {
      setInsights({});
      return;
    }
    setLoadingInsights(true);
    const res = await fetch("/api/meta/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: selectedAccounts.map((a) => a.account_id), datePreset: preset }),
    });
    const d = await res.json();
    setInsights(d.insights ?? {});
    setLoadingInsights(false);
  }, [selectedAccounts, preset]);

  useEffect(() => {
    // Só busca no Meta (o que consome requisição de verdade) quando a aba
    // que precisa desse dado está ativa — Acompanhamento (tabela). Nas
    // outras abas, essa chamada não roda.
    if (tab !== "acompanhamento") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca os insights ao entrar na aba, ou quando seleção/período mudam com a aba já ativa
    void loadInsights();
  }, [loadInsights, tab]);

  // Ritmo (coluna de Acompanhamento) precisa do gasto do MÊS CORRENTE
  // sempre, independente do período escolhido no filtro da tabela acima —
  // por isso é uma busca à parte, presa em "this_month" e não em `preset`.
  // Só depende da seleção de contas, não do período, pra não duplicar
  // chamada toda vez que o filtro de data da tabela mudar.
  const loadMonthlyInsights = useCallback(async () => {
    if (selectedAccounts.length === 0) {
      setMonthlyInsights({});
      return;
    }
    const res = await fetch("/api/meta/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: selectedAccounts.map((a) => a.account_id), datePreset: "this_month" }),
    });
    const d = await res.json();
    setMonthlyInsights(d.insights ?? {});
  }, [selectedAccounts]);

  useEffect(() => {
    if (tab !== "acompanhamento") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o gasto do mês (fixo, pro Ritmo) ao entrar na aba ou trocar a seleção de contas
    void loadMonthlyInsights();
  }, [loadMonthlyInsights, tab]);

  async function saveSelectedAccounts(ids: string[]) {
    setSelectedIds(ids);
    await fetch("/api/selected-accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: ids }),
    });
  }

  async function patchBinding(accountId: string, patch: BindingPatch) {
    const current = bindings[accountId] ?? defaultBinding(accountId);
    const next = { ...current, ...patch };
    setBindings((prev) => ({ ...prev, [accountId]: next }));
    await fetch("/api/account-bindings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, ...patch }),
    });
  }

  // Reordenação por arrastar-e-soltar (Acompanhamento) — grava sort_order de
  // cada conta atrelado ao usuário no Supabase (não usa localStorage/sessionStorage:
  // precisa valer igual em qualquer navegador/computador que o usuário abra).
  async function persistOrder(orderedAccountIds: string[]) {
    setBindings((prev) => {
      const next = { ...prev };
      orderedAccountIds.forEach((id, index) => {
        next[id] = { ...(next[id] ?? defaultBinding(id)), sort_order: index };
      });
      return next;
    });
    await fetch("/api/account-bindings/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: orderedAccountIds }),
    });
  }

  async function patchPix(accountId: string, patch: PixPatch) {
    const current = pixAccounts[accountId] ?? {
      ad_account_id: accountId,
      payment_type: "prepaid",
      base_amount: null,
      notes: null,
      alert_threshold: null,
    };
    const next = { ...current, ...patch };
    setPixAccounts((prev) => ({ ...prev, [accountId]: next }));
    await fetch("/api/pix-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, ...patch }),
    });
  }

  const allRows = useMemo(() => {
    return selectedAccounts.map((acc) => {
      const binding = bindings[acc.account_id];
      const insight = insights[acc.account_id];
      return {
        acc,
        binding,
        insight,
        clientName: binding?.client_name || acc.name,
      };
    });
  }, [selectedAccounts, bindings, insights]);

  const activeFocusGroup = useMemo(
    () => focusGroups.find((g) => g.id === activeFocusGroupId) ?? null,
    [focusGroups, activeFocusGroupId],
  );

  const focusFilteredRows = useMemo(() => {
    if (!activeFocusGroup) return allRows;
    const set = new Set(activeFocusGroup.accountIds);
    return allRows.filter((r) => set.has(r.acc.account_id));
  }, [allRows, activeFocusGroup]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return focusFilteredRows
      .filter(
        (r) =>
          !q || r.clientName.toLowerCase().includes(q) || r.acc.name.toLowerCase().includes(q),
      )
      .filter((r) => priorityFilter === "all" || (r.binding?.priority ?? "") === priorityFilter)
      .filter((r) => {
        if (cpaFilter !== "high") return true;
        const cpaTarget = r.binding?.cpa_target;
        const cpaActual = r.insight?.cost_per_result;
        return cpaTarget != null && cpaActual != null && cpaActual > cpaTarget;
      })
      .filter((r) => {
        if (investFilter === "all") return true;
        const rowRitmo = ritmo(r.binding?.monthly_investment, monthlyInsights[r.acc.account_id]?.spend);
        if (rowRitmo == null) return false;
        const diff = rowRitmo - (r.insight?.daily_budget ?? 0);
        if (investFilter === "low") return diff > RITMO_BAND;
        return diff < -RITMO_BAND;
      })
      .sort((a, b) => rowSortKey(a) - rowSortKey(b));
  }, [focusFilteredRows, search, priorityFilter, cpaFilter, investFilter, monthlyInsights]);

  // Arrastar só faz sentido reordenando a lista completa e visível — com
  // busca, grupo de foco ou qualquer um dos 3 filtros (Status/CPA/
  // Investimento) ativos, a posição de um item na tela não bate com sua
  // posição "de verdade" entre todas as contas, então desabilita.
  const reorderEnabled =
    search.trim() === "" &&
    activeFocusGroupId === null &&
    priorityFilter === "all" &&
    cpaFilter === "all" &&
    investFilter === "all";

  function handleRowDrop(targetAccountId: string) {
    if (!draggedAccountId || draggedAccountId === targetAccountId) return;
    const ids = rows.map((r) => r.acc.account_id);
    const from = ids.indexOf(draggedAccountId);
    const to = ids.indexOf(targetAccountId);
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, draggedAccountId);
    void persistOrder(next);
  }

  const editingRow = editingAccountId ? allRows.find((r) => r.acc.account_id === editingAccountId) : undefined;

  if (selectedIds === null || allAccounts === null) {
    return <div className="p-8 text-sm text-zinc-500">Carregando…</div>;
  }

  return (
    <div className="w-full px-4 py-6 md:px-8">
      <header className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">Painel</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Visão geral das suas contas
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Mostrando {selectedAccounts.length} conta(s) selecionada(s).
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="h-9 shrink-0 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-950"
          >
            Contas exibidas{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </button>
        </div>
      </header>

      {accountsError ? (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {accountsError}
        </div>
      ) : selectedAccounts.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nenhuma conta selecionada.{" "}
          <button onClick={() => setPickerOpen(true)} className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Escolher contas
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr] md:gap-6">
          <aside className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </aside>

          <div className="min-w-0">
            {tab === "acompanhamento" ? (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Acompanhamento de Resultados {loadingInsights ? "· atualizando…" : ""}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <FocusGroupsBar
                      accounts={selectedAccounts}
                      groups={focusGroups}
                      activeGroupId={activeFocusGroupId}
                      onGroupsChange={saveFocusGroups}
                      onActiveGroupChange={setActiveFocusGroupId}
                    />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar cliente ou conta…"
                      className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
                    />
                    <select
                      value={preset}
                      onChange={(e) => setPreset(e.target.value as PresetId)}
                      className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
                    >
                      {DATE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        void loadInsights();
                        void loadMonthlyInsights();
                      }}
                      disabled={loadingInsights}
                      className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      {loadingInsights ? "Atualizando…" : "↻ Atualizar"}
                    </button>
                    <button
                      onClick={() => setBulkStatusOpen(true)}
                      className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
                    >
                      Atualizar status em massa
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Status</span>
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                      className="h-7 rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
                    >
                      <option value="all">Todos</option>
                      {priorityOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">CPA</span>
                    <select
                      value={cpaFilter}
                      onChange={(e) => setCpaFilter(e.target.value as "all" | "high")}
                      className="h-7 rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
                    >
                      <option value="all">Todos</option>
                      <option value="high">CPA alto</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Investimento</span>
                    <select
                      value={investFilter}
                      onChange={(e) => setInvestFilter(e.target.value as "all" | "low" | "high")}
                      className="h-7 rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
                    >
                      <option value="all">Todos</option>
                      <option value="low">Baixo</option>
                      <option value="high">Alto</option>
                    </select>
                  </div>
                </div>

                {!reorderEnabled ? (
                  <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                    Para arrastar e reordenar os clientes, limpe a busca, o grupo de foco e os filtros de Status/CPA/
                    Investimento — a reordenação vale para a lista completa.
                  </p>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                        <th className="w-6 px-2 py-2 font-medium"></th>
                        <th className="px-4 py-2 font-medium">Cliente</th>
                        <th className="px-4 py-2 font-medium">Conta</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="Editável aqui ou em Clientes — os dois ficam sincronizados"
                        >
                          CPA ideal
                        </th>
                        <th className="px-4 py-2 text-right font-medium">CPA</th>
                        <th className="px-4 py-2 text-right font-medium">Valor usado</th>
                        <th className="px-4 py-2 text-right font-medium">Invest. diário</th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="(Investimento mensal − Valor usado nesse mês) ÷ dias restantes do mês (mês sempre considerado com 30 dias, incluindo hoje como 1 dos dias restantes)"
                        >
                          Ritmo
                        </th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ acc, binding, insight }) => {
                        const priorityOption = priorityOptions.find((p) => p.id === binding?.priority);
                        const rowRitmo = ritmo(binding?.monthly_investment, monthlyInsights[acc.account_id]?.spend);
                        return (
                          <tr
                            key={acc.id}
                            draggable={reorderEnabled}
                            onDragStart={() => setDraggedAccountId(acc.account_id)}
                            onDragOver={(e) => {
                              if (reorderEnabled) e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleRowDrop(acc.account_id);
                              setDraggedAccountId(null);
                            }}
                            onDragEnd={() => setDraggedAccountId(null)}
                            className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                              draggedAccountId === acc.account_id ? "opacity-40" : ""
                            }`}
                          >
                            <td
                              className={`px-2 py-2 text-zinc-300 dark:text-zinc-600 ${
                                reorderEnabled ? "cursor-grab select-none" : ""
                              }`}
                              title={reorderEnabled ? "Arraste para reordenar" : undefined}
                            >
                              {reorderEnabled ? "⠿" : ""}
                            </td>
                            <td className="px-4 py-2">
                              <input
                                defaultValue={binding?.client_name ?? ""}
                                placeholder={acc.name}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (binding?.client_name ?? "")) void patchBinding(acc.account_id, { client_name: v || null });
                                }}
                                className="w-36 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-zinc-900 dark:hover:border-zinc-700 dark:focus:border-zinc-100"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <a
                                href={adsManagerUrl(acc.account_id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir no Gerenciador de Anúncios"
                                className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                              >
                                {acc.name}
                              </a>
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={binding?.priority ?? ""}
                                onChange={(e) => void patchBinding(acc.account_id, { priority: e.target.value || null })}
                                style={
                                  priorityOption
                                    ? {
                                        backgroundColor: `${priorityOption.color}22`,
                                        color: priorityOption.color,
                                        borderColor: `${priorityOption.color}55`,
                                      }
                                    : undefined
                                }
                                className="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs font-medium dark:border-zinc-700"
                              >
                                <option value="">—</option>
                                {priorityOptions.map((p) => (
                                  <option key={p.id} value={p.id} style={{ color: p.color }}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <InlineNumber
                                value={binding?.cpa_target ?? null}
                                onSave={(v) => patchBinding(acc.account_id, { cpa_target: v })}
                              />
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {(() => {
                                const cpaActual = insight?.cost_per_result;
                                const cpaTarget = binding?.cpa_target;
                                const diff = cpaActual != null && cpaTarget != null ? cpaActual - cpaTarget : null;
                                const colorClass = cpaDiffColorClass(diff);
                                return (
                                  <>
                                    <div className={colorClass}>{fmtCurrency(cpaActual)}</div>
                                    {diff != null ? (
                                      <div className={`text-sm font-medium ${colorClass}`}>{fmtCurrencySigned(diff)}</div>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(insight?.spend ?? 0)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(insight?.daily_budget ?? 0)}</td>
                            <td
                              className={`px-4 py-2 text-right tabular-nums ${ritmoColorClass(rowRitmo, insight?.daily_budget)}`}
                              title={
                                rowRitmo != null
                                  ? fmtCurrencySigned((insight?.daily_budget ?? 0) - rowRitmo)
                                  : undefined
                              }
                            >
                              {fmtCurrency(rowRitmo)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => setEditingAccountId(acc.account_id)}
                                className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium dark:border-zinc-700"
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {tab === "evolucao" ? (
              <EvolucaoTab
                accounts={selectedAccounts}
                clientNames={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.clientName]))}
              />
            ) : null}

            {tab === "clientes" ? (
              <ClientesTab
                accounts={selectedAccounts}
                bindings={bindings}
                onPatch={patchBinding}
                onRefresh={loadAccounts}
                refreshing={loadingAccounts}
              />
            ) : null}

            {tab === "saldo" ? (
              <ControleSaldo
                accounts={selectedAccounts}
                clientNames={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.clientName]))}
                pixByAccount={pixAccounts}
                onPatch={patchPix}
                onRefresh={loadAccounts}
                refreshing={loadingAccounts}
              />
            ) : null}

            {tab === "visao-geral" ? <VisaoGeral accounts={selectedAccounts} preset={preset} /> : null}

            {tab === "analise" ? <AnaliseTab accounts={selectedAccounts} /> : null}
          </div>
        </div>
      )}

      <ContasExibidasDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedIds={selectedIds}
        onSave={saveSelectedAccounts}
      />

      <BulkStatusDialog
        open={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        candidates={rows.map((r) => ({
          accountId: r.acc.account_id,
          clientName: r.clientName,
          cpaTarget: r.binding?.cpa_target ?? null,
          priority: r.binding?.priority ?? null,
        }))}
        onApply={(accountId, priority) => patchBinding(accountId, { priority })}
      />

      <EditClientDialog
        open={editingAccountId !== null}
        onClose={() => setEditingAccountId(null)}
        accountId={editingAccountId}
        clientName={editingRow?.clientName ?? ""}
        binding={editingRow?.binding}
        onPatch={patchBinding}
      />
    </div>
  );
}
