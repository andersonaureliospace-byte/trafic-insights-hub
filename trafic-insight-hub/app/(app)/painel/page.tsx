"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdAccount, AccountInsight } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency, fmtCurrencySigned, priorityRank, type PresetId } from "@/lib/format";
import { adsManagerUrl, registerAccountBusinesses } from "@/lib/meta/ads-manager-link";
import { ritmoFromInsight, ritmoTooltip, ritmoColorClass, RITMO_BAND } from "@/lib/meta/ritmo";
import { CPA_ACCEPTABLE_BAND, METAS_SORTS, compareMetas, computeMetas, metasCalendar, type MetasSort } from "@/lib/meta/metas";
import { usePriorityOptions } from "@/lib/priority-context";
import { ContasExibidasDialog } from "@/components/painel/contas-exibidas-dialog";
import { ControleSaldo } from "@/components/painel/controle-saldo";
import { AnaliseTab } from "@/components/painel/analise-tab";
import { CopyTab } from "@/components/painel/copy-tab";
import { EvolucaoTab } from "@/components/painel/evolucao-tab";
import { MonitorCpaTab } from "@/components/painel/monitor-cpa-tab";
import { PIN_BLUR, PinCell } from "@/components/painel/pin-cell";
import { MetasTab } from "@/components/painel/metas-tab";
import { EditClientDialog } from "@/components/painel/edit-client-dialog";
import { InlineNumber } from "@/components/painel/inline-number";
import { OptimizedCell } from "@/components/painel/optimized-cell";
import { ClientNameHover } from "@/components/painel/client-name-hover";
import { usePainelUiState } from "@/lib/hooks/use-painel-ui-state";
import { FRESH_MS, fmtCacheTime, isFresh, readTabCache, writeTabCache } from "@/lib/client-cache";

// Dia de hoje (YYYY-MM-DD) no fuso de Brasília — mesma regra do servidor (spDate) pro reset do "Otimizado".
function brtDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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
  optimized: boolean | null;
  // Etapa 83: marcação própria da aba "Otimizado", separada de `optimized`.
  tab_optimized: boolean | null;
  // Etapa 131: cliente ativo (padrão) ou desativado. Ausente/null = ativo.
  active?: boolean | null;
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
    optimized: false,
    tab_optimized: false,
  };
}

interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  notes: string | null;
  alert_threshold: number | null;
  friday_multiplier: number | null;
  manual_check_mode: string | null;
  manual_check_weekdays: number[] | null;
  manual_check_interval_days: number | null;
  manual_check_repeat: boolean | null;
  manual_check_next_at: string | null;
  // Etapa 73: destino do envio de Pix por WhatsApp — ver
  // components/painel/personalizar-alertas-dialog.tsx.
  pix_target_type: "grupo" | "numero" | null;
  pix_target_number: string | null;
  // Etapa 81: "Saldo por fundos" — ver
  // components/painel/personalizar-alertas-dialog.tsx.
  funds_balance_enabled: boolean | null;
  funds_balance_amount: number | null;
  funds_balance_currency: string | null;
  funds_balance_watermark: string | null;
  funds_balance_updated_at: string | null;
}

type BindingPatch = Partial<Omit<AccountBinding, "ad_account_id">>;
type PixPatch = Partial<Omit<PixRow, "ad_account_id">>;

// Etapa 98: ordenação extra de Acompanhamento (fora de METAS_SORTS, que é compartilhada
// com a aba de metas, onde não existe prioridade).
const PRIORITY_CPA_SORT = "priority_cpa" as const;
type SortMode = "manual" | MetasSort | typeof PRIORITY_CPA_SORT;

// Chave de ordenação da tabela de Acompanhamento: quem já foi arrastado
// manualmente usa sort_order (crescente); quem nunca foi mexido cai pro
// final, ordenado por gasto (maior gasto primeiro) — igual ao comportamento
// antigo. Função pura fora do componente + comparador de uma expressão só
// pro React Compiler conseguir preservar a memoização do useMemo abaixo.
// Etapa 90: busca automática (entrar na aba) só repete depois disso; ↻ sempre busca.
// Etapa 124: só evita disparar a mesma busca 2x seguidas (efeitos re-rodando); quem decide se busca é o
// backup local (lib/client-cache.ts): entrou na aba com dado recente salvo → não busca.
const AUTO_RELOAD_MS = 60 * 1000;

function rowSortKey(row: { binding?: AccountBinding; insight?: AccountInsight }): number {
  return row.binding?.sort_order ?? (1_000_000_000 - (row.insight?.spend ?? 0));
}

// Ritmo e RITMO_BAND agora moram em lib/meta/ritmo.ts (Etapa 53) — extraídos
// pra serem reaproveitados também pelo aviso automático de investimento
// baixo (lib/alerts/low-investment.ts), com a mesma conta exata.
//
// ritmoColorClass (cor da diferença embaixo de "Invest. diário") agora mora em
// lib/meta/ritmo.ts (Etapa 82) — compartilhada com Acompanhamento de metas.

// Cor da coluna CPA (Acompanhamento): compara o CPA real com o CPA ideal
// cadastrado do cliente — diferença = CPA − CPA ideal.
// - diferença negativa (CPA abaixo do ideal) → verde
// - diferença de 0 até R$2,50 acima do ideal → laranja (atenção)
// - diferença acima de R$2,50 do ideal → vermelho
// Etapa 94: mesma banda de Acompanhamento de metas (CPA_ACCEPTABLE_BAND, R$2,50).
const CPA_ORANGE_BAND = CPA_ACCEPTABLE_BAND;
function cpaDiffColorClass(diff: number | null): string {
  if (diff == null) return "";
  if (diff < 0) return "text-emerald-600 dark:text-emerald-400";
  if (diff <= CPA_ORANGE_BAND) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

// Subgrupos na lateral — cada um só busca dados do Meta (o que pesa nas
// requisições) enquanto estiver ativo. Trocar de aba não deixa nada
// "grudado" buscando em segundo plano.
// Etapa 141: menu enxuto, nesta ordem. Saíram: Visão Geral e Demandas (excluídas), Clientes (foi pra Configurações) e
// Alertas / Padrão de nomes / Descrição (foram pra Auditoria). "Acompanhamento" virou "Desempenho" e
// "Acompanhamento de metas" virou "Metas" (os ids internos continuam os mesmos, pra não perder o estado salvo).
const TABS = [
  { id: "acompanhamento", label: "Desempenho" },
  { id: "analise", label: "Análise" },
  { id: "saldo", label: "Controle de Saldo" },
  { id: "metas", label: "Metas" },
  { id: "monitor-cpa", label: "Monitor de CPA" },
  { id: "evolucao", label: "Evolução" },
  { id: "copy", label: "Copy" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function PainelPage() {
  const { options: priorityOptions } = usePriorityOptions();
  const [tab, setTab] = useState<TabId>("acompanhamento");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [allAccounts, setAllAccounts] = useState<AdAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  // Etapa 123: aviso de que a lista de contas é a salva no navegador (a Meta não respondeu).
  const [accountsStale, setAccountsStale] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, AccountBinding>>({});
  // Etapa 131: só mostra contas depois de ler quem está desativado — assim uma conta desativada nem chega a consultar a Meta.
  const [bindingsLoaded, setBindingsLoaded] = useState(false);
  // Dia (YYYY-MM-DD em Brasília) em que as marcações foram lidas — usado pra detectar a virada do dia.
  const bindingsDayRef = useRef<string | null>(null);
  const [pixAccounts, setPixAccounts] = useState<Record<string, PixRow>>({});
  const [insights, setInsights] = useState<Record<string, AccountInsight>>({});
  const [monthlyInsights, setMonthlyInsights] = useState<Record<string, AccountInsight>>({});
  const [loadingInsights, setLoadingInsights] = useState(false);
  // Etapa 124: hora da última atualização de cada bloco (vem do backup local ou da busca) — aparece ao lado do ↻.
  const [insightsAt, setInsightsAt] = useState<number | null>(null);
  const insightsRef = useRef<Record<string, AccountInsight>>({});
  const monthlyRef = useRef<Record<string, AccountInsight>>({});
  const [preset, setPreset] = useState<PresetId>("last_7d");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 3 filtros novos de Acompanhamento — todos começam fixos em "Todos" (sem
  // filtrar nada) até o usuário escolher outra opção.
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [cpaFilter, setCpaFilter] = useState<"all" | "high">("all");
  const [investFilter, setInvestFilter] = useState<"all" | "low" | "high">("all");
  // Filtro da coluna "Otimizado" (Etapa 36) — mesmo padrão dos outros 3:
  // começa fixo em "Todos".
  const [optimizedFilter, setOptimizedFilter] = useState<"all" | "optimized" | "pending">("all");
  // Etapa 83: Acompanhamento de metas tem a própria coluna Otimizado e o próprio
  // filtro Otimizado/Pendente — não compartilha nada com os de Acompanhamento.
  // Etapa 86: contas fixadas (botão Fixar) — uma lista por aba, salvas no
  // ui-state do Supabase e mantidas até desafixar. Fixada sobe pro topo, as
  // outras ficam embaçadas e o "↻ Atualizar" busca só as fixadas.
  // Etapa 87: mesmo seletor de ordenação de Acompanhamento de metas. "manual" =
  // a ordem personalizada de antes (arrastar e soltar), continua sendo o padrão.
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const metasCal = useMemo(() => metasCalendar(), []);
  // Última busca automática (por aba/período/contas) — evita rebuscar tudo toda vez que o
  // usuário volta pra aba (Etapa 90).
  const autoLoadRef = useRef<{
    insights: { key: string; at: number } | null;
    monthly: { key: string; at: number } | null;
    alerts: number | null;
  }>({ insights: null, monthly: null, alerts: null });
  // Etapa 118: as buscas pesadas na Meta (insights do período, gasto do mês, saldo, pagamento)
  // rodam UMA DE CADA VEZ, em fila. Antes, ao abrir o Acompanhamento, as quatro disparavam juntas
  // (~15 chamadas simultâneas à Meta) e estouravam o limite de requisições — a tela travava/dava erro.
  const metaQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Etapa 119: quantas buscas estão na fila/rodando e quais falharam — alimenta o indicador fixo
  // de "Carregando…/Erro" embaixo do menu lateral.
  const [metaPending, setMetaPending] = useState(0);
  const [metaFailed, setMetaFailed] = useState<Record<string, boolean>>({});
  const queueMeta = useCallback(<T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    setMetaPending((n) => n + 1);
    const run = metaQueueRef.current.then(fn, fn);
    metaQueueRef.current = run.catch(() => undefined);
    return run
      .then((r) => {
        setMetaFailed((f) => (f[label] === (r === false) ? f : { ...f, [label]: r === false }));
        return r;
      })
      .catch((e) => {
        setMetaFailed((f) => (f[label] ? f : { ...f, [label]: true }));
        throw e;
      })
      .finally(() => setMetaPending((n) => Math.max(0, n - 1)));
  }, []);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const pinnedRef = useRef<string[]>([]);
  useEffect(() => {
    pinnedRef.current = pinnedIds;
  }, [pinnedIds]);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  // Contas com saldo baixo / erro no pagamento (Etapa 39) — só pra colorir o
  // nome da conta em Acompanhamento; quem decide "baixo"/"erro" de verdade é
  // a mesma lógica de Mensagens > Avisos (lib/alerts/balance.ts e
  // lib/alerts/payment.ts), aqui só em modo leitura (nunca manda WhatsApp).
  const [lowBalanceIds, setLowBalanceIds] = useState<Set<string>>(new Set());
  const [paymentErrorIds, setPaymentErrorIds] = useState<Set<string>>(new Set());

  // Etapa 39: lembrar a aba ativa + os filtros de cada aba entre uma sessão
  // e outra (F5 não joga mais pra Visão Geral do zero) — salvo no Supabase
  // (nunca localStorage/sessionStorage), mesmo critério já usado na
  // reordenação por arrastar-e-soltar de Acompanhamento.
  const { state: uiState, patch: patchUiState } = usePainelUiState();
  const uiHydrated = useRef(false);

  // Contas do Meta (nome, status, saldo/teto de gasto, tipo de negócio) —
  // é o que alimenta Controle de Saldo. Função à parte (não só um efeito)
  // pra dar pra chamar de novo pelo botão "Atualizar" sem precisar dar F5.
  // Etapa 123: a última lista de contas que veio certa fica guardada no navegador. Se a Meta bloquear por excesso de
  // chamadas (ou cair), o Painel abre com essa lista salva (avisando) em vez de ficar sem contas.
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    const CACHE_KEY = "painel_accounts_cache_v1";
    const useSaved = (errMsg: string): boolean => {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw) as { at?: number; accounts?: AdAccount[] };
        if (!saved.accounts || saved.accounts.length === 0) return false;
        registerAccountBusinesses(saved.accounts);
        setAllAccounts(saved.accounts);
        setAccountsError(null);
        const hhmm = saved.at
          ? new Date(saved.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
          : "antes";
        setAccountsStale(`${errMsg} Mostrando a lista de contas salva às ${hhmm} — saldos e gastos podem estar desatualizados.`);
        return true;
      } catch {
        return false;
      }
    };
    try {
      const res = await fetch("/api/meta/accounts", { signal: AbortSignal.timeout(90_000) });
      const d = await res.json();
      if (d.error) {
        if (!useSaved(String(d.error))) setAccountsError(d.error);
      } else {
        setAccountsError(null);
        setAccountsStale(null);
        registerAccountBusinesses(d.accounts ?? []);
        setAllAccounts(d.accounts ?? []);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), accounts: d.accounts ?? [] }));
        } catch {
          /* sem armazenamento: segue sem cache */
        }
      }
    } catch {
      // Sem resposta (limite da Meta, queda de rede, tempo esgotado).
      const msg = "Não consegui carregar as contas da Meta (sem resposta do servidor).";
      if (!useSaved(msg)) setAccountsError(msg);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  // Carrega seleção, contas do Meta (1 chamada só) e vínculos/PIX (Supabase,
  // barato) de cara — o que é pesado de verdade (insights/breakdown/análise
  // do Meta) só é buscado quando a aba correspondente está ativa, mais
  // abaixo.
  // Marcações de "Otimizado" (Acompanhamento e Acompanhamento de metas) valem só pro dia de hoje em
  // Brasília: o servidor já devolve "não otimizado" pra marcação de ontem, mas a tela só lia isso UMA vez
  // ao abrir. Quem deixa o Painel aberto de um dia pro outro continuava vendo o dia anterior. Agora a tela
  // relê as marcações quando o dia (BRT) vira e quando você volta pra aba.
  const loadBindings = useCallback(async () => {
    try {
      const r = await fetch("/api/account-bindings", { cache: "no-store" });
      const d = await r.json();
      const map: Record<string, AccountBinding> = {};
      for (const b of d.bindings ?? []) map[b.ad_account_id] = b;
      setBindings(map);
      bindingsDayRef.current = brtDay();
    } catch {
      // sem rede: tenta de novo na próxima checagem
    } finally {
      setBindingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    function checkNewDay() {
      if (bindingsDayRef.current && bindingsDayRef.current !== brtDay()) void loadBindings();
    }
    const t = setInterval(checkNewDay, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkNewDay();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkNewDay);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkNewDay);
    };
  }, [loadBindings]);

  useEffect(() => {
    fetch("/api/selected-accounts")
      .then((r) => r.json())
      .then((d) => setSelectedIds(d.accountIds ?? []));

    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca as contas do Meta ao montar; o mesmo loadAccounts é reusado pelo botão "Atualizar" de Controle de Saldo/Clientes
    void loadAccounts();

    void loadBindings();

    fetch("/api/pix-accounts")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, PixRow> = {};
        for (const p of d.pixAccounts ?? []) map[p.ad_account_id] = p;
        setPixAccounts(map);
      });
  }, [loadAccounts, loadBindings]);

  // Etapa 39: assim que a aba/filtros salvos chegam do Supabase, aplica uma
  // única vez (uiHydrated evita reaplicar e "prender" o usuário se ele
  // trocar de aba/filtro logo em seguida, antes da 1ª leitura terminar).
  useEffect(() => {
    if (uiState === null || uiHydrated.current) return;
    uiHydrated.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restaura a aba/filtros salvos assim que o estado do Supabase chega, uma única vez (uiHydrated evita repetir)
    // Etapa 141: aba salva que não existe mais (Visão Geral, Demandas, Clientes…) cai em Desempenho.
    if (typeof uiState.tab === "string" && TABS.some((t) => t.id === uiState.tab)) setTab(uiState.tab as TabId);
    const a = (uiState.acompanhamento ?? {}) as Record<string, unknown>;
    if (typeof a.search === "string") setSearch(a.search);
    if (typeof a.priorityFilter === "string") setPriorityFilter(a.priorityFilter);
    if (a.cpaFilter === "all" || a.cpaFilter === "high") setCpaFilter(a.cpaFilter);
    if (a.investFilter === "all" || a.investFilter === "low" || a.investFilter === "high") setInvestFilter(a.investFilter);
    if (a.optimizedFilter === "all" || a.optimizedFilter === "optimized" || a.optimizedFilter === "pending")
      setOptimizedFilter(a.optimizedFilter);
    const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    if (a.sortMode === "manual" || a.sortMode === PRIORITY_CPA_SORT || METAS_SORTS.some((s) => s.id === a.sortMode)) setSortMode(a.sortMode as SortMode);
    setPinnedIds(strList(a.pinnedIds));
    if (typeof a.preset === "string") setPreset(a.preset as PresetId);
  }, [uiState]);

  // Salva a aba ativa + os filtros de Acompanhamento sempre que mudam (com
  // debounce, dentro do hook) — só depois de já ter restaurado o que tinha
  // salvo, senão os valores iniciais (antes da leitura chegar) sobrescreveriam.
  useEffect(() => {
    if (!uiHydrated.current) return;
    patchUiState({
      tab,
      acompanhamento: {
        search,
        priorityFilter,
        cpaFilter,
        investFilter,
        optimizedFilter,
        pinnedIds,
        sortMode,
        preset,
      },
    });
  }, [
    tab,
    search,
    priorityFilter,
    cpaFilter,
    investFilter,
    optimizedFilter,
    pinnedIds,
    sortMode,
    preset,
    patchUiState,
  ]);

  const handleAnaliseFiltersChange = useCallback(
    (filters: { mode: string; subPanel: string; preset: string; search: string }) => {
      patchUiState({ analise: filters });
    },
    [patchUiState],
  );

  // Status de saldo baixo / erro no pagamento — só pra colorir o nome da
  // conta em Acompanhamento (mesma checagem de Mensagens > Avisos, em modo
  // leitura). Só busca com a aba ativa, mesmo critério das outras chamadas
  // "pesadas" do Meta.
  const loadAlertStatuses = useCallback(() => queueMeta("saldo e pagamento", async () => {
    const balanceRes = await fetch("/api/alerts/balance", { signal: AbortSignal.timeout(90_000) }).then((r) => r.json()).catch(() => ({}));
    const paymentRes = await fetch("/api/alerts/payment", { signal: AbortSignal.timeout(90_000) }).then((r) => r.json()).catch(() => ({}));
    // Se a Meta falhou (limite de requisições), mantém o que já estava na tela em vez de apagar as cores.
    if (balanceRes.statuses && paymentRes.statuses) {
      writeTabCache("acomp-alertas", {
        low: ((balanceRes.statuses ?? []) as Array<{ ad_account_id: string; low: boolean }>).filter((x) => x.low).map((x) => x.ad_account_id),
        pay: ((paymentRes.statuses ?? []) as Array<{ ad_account_id: string; hasError: boolean }>).filter((x) => x.hasError).map((x) => x.ad_account_id),
      });
    }
    if (balanceRes.statuses) setLowBalanceIds(
      new Set(
        ((balanceRes.statuses ?? []) as Array<{ ad_account_id: string; low: boolean }>)
          .filter((s) => s.low)
          .map((s) => s.ad_account_id),
      ),
    );
    if (paymentRes.statuses) setPaymentErrorIds(
      new Set(
        ((paymentRes.statuses ?? []) as Array<{ ad_account_id: string; hasError: boolean }>)
          .filter((s) => s.hasError)
          .map((s) => s.ad_account_id),
      ),
    );
    return !!(balanceRes.statuses && paymentRes.statuses);
  }), [queueMeta]);

  useEffect(() => {
    if (tab !== "acompanhamento") return;
    const at = autoLoadRef.current.alerts;
    if (at && Date.now() - at < AUTO_RELOAD_MS) return;
    autoLoadRef.current.alerts = Date.now();
    // Etapa 124: mostra o backup na hora; só busca na Meta se não tem backup recente.
    const c = readTabCache<{ low: string[]; pay: string[] }>("acomp-alertas");
    if (c) {
      setLowBalanceIds(new Set(c.data.low));
      setPaymentErrorIds(new Set(c.data.pay));
      if (isFresh(c)) return;
    }
    void loadAlertStatuses();
  }, [loadAlertStatuses, tab]);

  // Etapa 131: TODAS as contas exibidas, inclusive as de clientes desativados — só a aba Clientes usa (pra poder reativar).
  const selectedAccountsAll = useMemo(() => {
    if (!allAccounts || !selectedIds) return [];
    const set = new Set(selectedIds);
    return allAccounts.filter((a) => set.has(a.account_id));
  }, [allAccounts, selectedIds]);

  // Contas dos clientes ATIVOS: é o que todas as outras abas, buscas na Meta e filtros usam. Cliente desativado some daqui.
  const selectedAccounts = useMemo(() => {
    if (!bindingsLoaded) return [];
    return selectedAccountsAll.filter((a) => bindings[a.account_id]?.active !== false);
  }, [selectedAccountsAll, bindings, bindingsLoaded]);

  // Contas que o "↻ Atualizar" deve buscar: só as fixadas (se houver alguma
  // fixada entre as selecionadas), senão todas. A busca automática (entrar na
  // aba / trocar período) continua trazendo todas.
  const pinnedTargets = useCallback(() => {
    const pinned = selectedAccounts.filter((a) => pinnedRef.current.includes(a.account_id));
    return pinned.length > 0 ? pinned : null;
  }, [selectedAccounts]);

  const loadInsights = useCallback(
    (onlyPinned = false) => queueMeta("insights do período", async () => {
      if (selectedAccounts.length === 0) {
        setInsights({});
        return true;
      }
      const pinned = onlyPinned ? pinnedTargets() : null;
      setLoadingInsights(true);
      try {
        const res = await fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            accountIds: (pinned ?? selectedAccounts).map((a) => a.account_id),
            datePreset: preset,
          }),
        });
        const d = await res.json();
        // Erro geral da chamada: mantém o que já estava na tela em vez de zerar tudo.
        if (!d.insights) return false;
        const merged = pinned ? { ...insightsRef.current, ...d.insights } : d.insights;
        insightsRef.current = merged;
        setInsights(merged);
        setInsightsAt(writeTabCache(`acomp-insights:${preset}`, merged));
        return true;
      } catch {
        return false;
      } finally {
        setLoadingInsights(false);
      }
    }),
    [selectedAccounts, preset, pinnedTargets, queueMeta],
  );

  useEffect(() => {
    // Só busca no Meta (o que consome requisição de verdade) quando a aba
    // que precisa desse dado está ativa — Acompanhamento (tabela) e, desde a
    // Etapa 75, também Controle de Saldo (coluna "Invest. diário" usa
    // insight.daily_budget). Nas outras abas, essa chamada não roda.
    if (tab !== "acompanhamento" && tab !== "saldo") return;
    // Etapa 90: trocar de aba e voltar NÃO busca de novo (era uma busca completa a
    // cada volta — queimava requisições da Meta). Só busca se mudou período/contas
    // ou se a última busca automática tem mais de 5 minutos; o ↻ sempre busca.
    const key = `${preset}|${selectedAccounts.map((a) => a.account_id).join(",")}`;
    const last = autoLoadRef.current.insights;
    if (last && last.key === key && Date.now() - last.at < AUTO_RELOAD_MS) return;
    autoLoadRef.current.insights = { key, at: Date.now() };
    // Etapa 124: backup local primeiro (aparece na hora). Só vai à Meta se faltou conta, ou se o backup tem > 1h.
    // Nas demais situações, o ↻ Atualizar é quem busca.
    const c = readTabCache<Record<string, AccountInsight>>(`acomp-insights:${preset}`);
    if (c) {
      insightsRef.current = c.data;
      setInsights(c.data);
      setInsightsAt(c.at);
      if (isFresh(c, FRESH_MS) && selectedAccounts.every((a) => c.data[a.account_id])) return;
    } else {
      setInsightsAt(null);
    }
    void loadInsights().then((ok) => {
      if (!ok) autoLoadRef.current.insights = null;
    });
  }, [loadInsights, tab, preset, selectedAccounts]);

  // Ritmo (coluna de Acompanhamento) precisa do gasto do mês corrente ATÉ ONTEM
  // (Etapa 85: é comparado com o "Ideal até hoje") sempre, independente do
  // período escolhido no filtro da tabela acima — por isso é uma busca à
  // parte, presa em "this_month" (dia 01 até agora, com hoje) e não em `preset`.
  // Só depende da seleção de contas, não do período, pra não duplicar
  // chamada toda vez que o filtro de data da tabela mudar.
  const loadMonthlyInsights = useCallback(
    (onlyPinned = false) => queueMeta("gasto do mês", async () => {
      if (selectedAccounts.length === 0) {
        setMonthlyInsights({});
        return true;
      }
      const pinned = onlyPinned ? pinnedTargets() : null;
      try {
        const res = await fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            accountIds: (pinned ?? selectedAccounts).map((a) => a.account_id),
            datePreset: "this_month",
            // Só o gasto (Ritmo) — o orçamento diário já vem da busca principal.
            spendOnly: true,
          }),
        });
        const d = await res.json();
        if (!d.insights) return false;
        const merged = pinned ? { ...monthlyRef.current, ...d.insights } : d.insights;
        monthlyRef.current = merged;
        setMonthlyInsights(merged);
        writeTabCache("acomp-mensal", merged);
        return true;
      } catch {
        return false;
      }
    }),
    [selectedAccounts, pinnedTargets, queueMeta],
  );

  useEffect(() => {
    if (tab !== "acompanhamento") return;
    const key = selectedAccounts.map((a) => a.account_id).join(",");
    const last = autoLoadRef.current.monthly;
    if (last && last.key === key && Date.now() - last.at < AUTO_RELOAD_MS) return;
    autoLoadRef.current.monthly = { key, at: Date.now() };
    const c = readTabCache<Record<string, AccountInsight>>("acomp-mensal");
    if (c) {
      monthlyRef.current = c.data;
      setMonthlyInsights(c.data);
      if (isFresh(c, FRESH_MS) && selectedAccounts.every((a) => c.data[a.account_id])) return;
    }
    void loadMonthlyInsights().then((ok) => {
      if (!ok) autoLoadRef.current.monthly = null;
    });
  }, [loadMonthlyInsights, tab, selectedAccounts]);

  async function saveSelectedAccounts(ids: string[]) {
    setSelectedIds(ids);
    await fetch("/api/selected-accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: ids }),
    });
  }

  // Atualização otimista (aparece na hora), mas SEMPRE confere se o servidor
  // gravou de verdade — sem isso, um erro do Supabase (ex.: coluna fora do
  // cache de schema do PostgREST) passava batido: a tela mostrava o valor
  // novo, mas nada era salvo, e o campo voltava vazio na próxima vez que a
  // página carregava, sem nenhum aviso do que aconteceu.
  async function patchBinding(accountId: string, patch: BindingPatch) {
    const previous = bindings[accountId] ?? defaultBinding(accountId);
    const next = { ...previous, ...patch };
    setBindings((prev) => ({ ...prev, [accountId]: next }));
    const res = await fetch("/api/account-bindings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, ...patch }),
    });
    const d = await res.json().catch(() => ({ error: "Resposta inválida do servidor." }));
    if (d.error) {
      setBindings((prev) => ({ ...prev, [accountId]: previous }));
      alert(`Não deu pra salvar: ${d.error}`);
    }
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
      // Etapa 79: sem tipo definido até o usuário classificar manualmente
      // em Controle de Saldo → Configurações (antes era "prepaid" fixo).
      payment_type: null,
      base_amount: null,
      notes: null,
      alert_threshold: null,
      friday_multiplier: null,
      manual_check_mode: null,
      manual_check_weekdays: null,
      manual_check_interval_days: null,
      manual_check_repeat: true,
      manual_check_next_at: null,
      pix_target_type: "grupo" as const,
      pix_target_number: null,
      funds_balance_enabled: false,
      funds_balance_amount: null,
      funds_balance_currency: null,
      funds_balance_watermark: null,
      funds_balance_updated_at: null,
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

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows
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
        const rowRitmo = ritmoFromInsight(r.binding?.monthly_investment, monthlyInsights[r.acc.account_id]);
        if (rowRitmo == null) return false;
        const diff = rowRitmo - (r.insight?.daily_budget ?? 0);
        if (investFilter === "low") return diff > RITMO_BAND;
        return diff < -RITMO_BAND;
      })
      .filter((r) => {
        if (optimizedFilter === "all") return true;
        const isOptimized = !!r.binding?.optimized;
        return optimizedFilter === "optimized" ? isOptimized : !isOptimized;
      })
      .sort((a, b) => {
        if (sortMode === "manual") return rowSortKey(a) - rowSortKey(b);
        if (sortMode === PRIORITY_CPA_SORT) {
          // Etapa 98: agrupa por prioridade (Inauguração, Crítica, Alta, Média, Baixa, sem
          // prioridade) e, dentro de cada grupo, ordena pela mesma diferença que aparece
          // embaixo do CPA (CPA do período − CPA ideal), da maior pra menor. Sem diferença
          // calculável (sem CPA ou sem CPA ideal) vai pro fim do grupo.
          const rankDiff = priorityRank(a.binding?.priority) - priorityRank(b.binding?.priority);
          if (rankDiff !== 0) return rankDiff;
          const diffOf = (r: typeof a) =>
            r.insight?.cost_per_result != null && r.binding?.cpa_target != null
              ? r.insight.cost_per_result - r.binding.cpa_target
              : null;
          const da = diffOf(a);
          const db = diffOf(b);
          if (da == null && db == null) return a.clientName.localeCompare(b.clientName, "pt-BR");
          if (da == null) return 1;
          if (db == null) return -1;
          return db - da;
        }
        // Mesmos critérios da aba de metas, calculados com o que Acompanhamento
        // mostra: CPA do período escolhido vs CPA ideal; Invest. diário − Ritmo.
        const metas = (r: typeof a) =>
          computeMetas(
            {
              invested: monthlyInsights[r.acc.account_id]?.spend ?? 0,
              monthlyTarget: r.binding?.monthly_investment ?? null,
              cpa: r.insight?.cost_per_result ?? null,
              cpaTarget: r.binding?.cpa_target ?? null,
              dailyBudget: r.insight?.daily_budget ?? 0,
              ritmo: ritmoFromInsight(r.binding?.monthly_investment, monthlyInsights[r.acc.account_id]),
            },
            metasCal.elapsedDays,
            metasCal.daysInMonth,
          );
        return compareMetas(metas(a), metas(b), sortMode);
      })
      .sort((a, b) => Number(pinnedIds.includes(b.acc.account_id)) - Number(pinnedIds.includes(a.acc.account_id)));
  }, [
    sortMode,
    metasCal,
    pinnedIds,
    allRows,
    search,
    priorityFilter,
    cpaFilter,
    investFilter,
    optimizedFilter,
    monthlyInsights,
  ]);

  // Arrastar só faz sentido reordenando a lista completa e visível — com
  // busca ou qualquer um dos 4 filtros (Status/CPA/
  // Investimento/Otimizado) ativos, a posição de um item na tela não bate com sua
  // posição "de verdade" entre todas as contas, então desabilita.
  const hasPinned = selectedAccounts.some((a) => pinnedIds.includes(a.account_id));
  // Só conta depois que o gasto do mês chegou pelo menos uma vez (senão piscaria
  // o aviso enquanto a primeira busca ainda está rodando).
  const firstFailError = Object.values(monthlyInsights).find((i) => i.insights_error)?.insights_error;
  const failedAccounts =
    Object.keys(monthlyInsights).length === 0
      ? 0
      : selectedAccounts.filter((a) => !monthlyInsights[a.account_id] || monthlyInsights[a.account_id]?.insights_failed)
          .length;
  const reorderEnabled =
    !hasPinned &&
    sortMode === "manual" &&
    search.trim() === "" &&
    priorityFilter === "all" &&
    cpaFilter === "all" &&
    investFilter === "all" &&
    optimizedFilter === "all";

  function togglePin(id: string) {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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

  // Etapa 119: não bloqueia mais a tela inteira enquanto as contas carregam — o menu lateral fica
  // sempre visível e só a área de conteúdo mostra "Carregando…" ou o erro.
  const accountsReady = selectedIds !== null && allAccounts !== null && bindingsLoaded;
  const statusLoading = loadingAccounts || metaPending > 0 || selectedIds === null;
  const failedLabels = Object.entries(metaFailed).filter(([, v]) => v).map(([k]) => k);
  const statusErrors = [
    ...(accountsError ? ["contas"] : []),
    ...(accountsStale ? ["Meta limitou as chamadas"] : []),
    ...failedLabels,
    ...(failedAccounts > 0 ? [`${failedAccounts} conta(s) sem gasto do mês`] : []),
  ];

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
              {accountsReady
                ? `Mostrando ${selectedAccounts.length} conta(s) selecionada(s).` +
                  (selectedAccountsAll.length > selectedAccounts.length
                    ? ` ${selectedAccountsAll.length - selectedAccounts.length} cliente(s) desativado(s) — veja em Configurações → Clientes.`
                    : "")
                : "Carregando contas…"}
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="h-9 shrink-0 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-950"
          >
            Contas exibidas{selectedIds && selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </button>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 pb-40 md:grid-cols-[180px_1fr] md:gap-6">
          {/* Etapa 119: menu fixo ao rolar (no PC) e sempre visível — mesmo carregando ou com erro. */}
          <aside className="sticky top-14 z-20 -mx-4 flex gap-1 overflow-x-auto bg-zinc-50/95 px-4 py-1 backdrop-blur dark:bg-zinc-950/95 md:top-20 md:mx-0 md:max-h-[calc(100vh-6rem)] md:flex-col md:self-start md:overflow-x-visible md:overflow-y-auto md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
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
            {/* Indicador de estado: carregando / erro / tudo certo */}
            <div
              className={`hidden shrink-0 rounded-md border px-3 py-2 text-xs md:block ${
                statusErrors.length > 0
                  ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  : statusLoading
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
              title={statusErrors.length > 0 ? `Erro em: ${statusErrors.join(", ")}` : undefined}
            >
              {statusErrors.length > 0 ? (
                <>
                  <p className="font-semibold">⚠ Erro: {statusErrors.join(", ")}</p>
                  {statusLoading ? <p className="mt-0.5">Tentando de novo…</p> : null}
                  <button
                    onClick={() => {
                      void loadAccounts();
                      void loadInsights();
                      void loadMonthlyInsights();
                      void loadAlertStatuses();
                    }}
                    className="mt-1 font-medium underline"
                  >
                    Tentar de novo
                  </button>
                </>
              ) : statusLoading ? (
                <p className="font-semibold">
                  <span className="mr-1 inline-block animate-pulse">●</span>Carregando…
                  {metaPending > 1 ? ` (${metaPending} buscas na fila)` : ""}
                </p>
              ) : (
                <p className="font-semibold">✓ Tudo carregado</p>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {accountsStale ? (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {accountsStale}{" "}
                <button onClick={() => void loadAccounts()} className="font-medium underline">
                  Tentar de novo
                </button>
              </div>
            ) : null}
            {accountsError ? (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {accountsError}{" "}
                <button onClick={() => void loadAccounts()} className="font-medium underline">
                  Tentar de novo
                </button>
              </div>
            ) : null}
            {!accountsReady ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
                {accountsError ? "As contas não carregaram." : "Carregando contas…"} O menu ao lado continua funcionando.
              </div>
            ) : selectedAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
                Nenhuma conta selecionada.{" "}
                <button onClick={() => setPickerOpen(true)} className="font-medium text-zinc-900 underline dark:text-zinc-100">
                  Escolher contas
                </button>
              </div>
            ) : (
            <>
            {tab === "acompanhamento" ? (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Acompanhamento de Resultados {loadingInsights ? "· atualizando…" : ""}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar cliente ou conta…"
                      className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
                    />
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
                    >
                      <option value="manual">Ordem personalizada (arrastar)</option>
                      <option value={PRIORITY_CPA_SORT}>Prioridade + maior diferença do CPA (maior → menor)</option>
                      {METAS_SORTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
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
                        void loadInsights(true);
                        void loadMonthlyInsights(true);
                        // Com conta fixada, NÃO refaz o status de saldo/pagamento (isso consulta a
                        // Meta pra todas as contas) — fica só no que já foi carregado ao entrar na aba.
                        if (!hasPinned) void loadAlertStatuses();
                      }}
                      disabled={loadingInsights}
                      className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      {loadingInsights ? "Atualizando…" : hasPinned ? "↻ Atualizar fixadas" : "↻ Atualizar"}
                    </button>
                    {insightsAt ? (
                      <span className="text-xs text-zinc-400" title="Dados salvos neste navegador. Clique em ↻ Atualizar para buscar na Meta.">
                        atualizado às {fmtCacheTime(insightsAt)}
                      </span>
                    ) : null}
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
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Otimizado</span>
                    <select
                      value={optimizedFilter}
                      onChange={(e) => setOptimizedFilter(e.target.value as "all" | "optimized" | "pending")}
                      className="h-7 rounded-md border border-zinc-300 bg-transparent px-2 text-xs dark:border-zinc-700"
                    >
                      <option value="all">Todos</option>
                      <option value="optimized">Otimizado</option>
                      <option value="pending">Pendente</option>
                    </select>
                  </div>
                </div>

                {failedAccounts > 0 ? (
                  <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {failedAccounts} conta(s) não carregaram o gasto do mês (provável limite de requisições da Meta).
                    Ritmo fica em — nelas. Clique em Atualizar pra tentar de novo.
                    {firstFailError ? ` Motivo da Meta: ${firstFailError}` : ""}
                  </p>
                ) : null}

                {hasPinned ? (
                  <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Modo foco: só as contas fixadas estão em destaque e o Atualizar busca apenas elas. Passe o mouse
                    numa linha embaçada pra ver os números; desafixe pra voltar ao normal.
                  </p>
                ) : null}

                {!reorderEnabled ? (
                  <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                    Para arrastar e reordenar os clientes, limpe a busca, as contas fixadas, volte a ordenação pra Ordem personalizada e limpe os filtros de Status/CPA/
                    Investimento/Otimizado — a reordenação vale para a lista completa.
                  </p>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                        <th className="w-6 px-2 py-2 font-medium"></th>
                        <th className="px-4 py-2 font-medium" title="Fixa a conta no topo e foca só nela">
                          Fixar
                        </th>
                        <th
                          className="px-4 py-2 font-medium"
                          title="Marcação manual do dia — reseta sozinha à meia-noite (horário de Brasília)"
                        >
                          Otimizado
                        </th>
                        <th className="px-4 py-2 font-medium">Cliente</th>
                        <th className="px-4 py-2 font-medium">Conta</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Valor usado</th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="Conversas iniciadas — o mesmo Resultado que aparece no Gerenciador de Anúncios, campo results da Meta (o que também gera o CPA)"
                        >
                          Leads
                        </th>
                        <th className="px-4 py-2 text-right font-medium">CPA</th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="Editável aqui ou em Clientes — os dois ficam sincronizados"
                        >
                          CPA ideal
                        </th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="Abaixo: diferença entre o orçamento diário já configurado e o Ritmo (Invest. diário − Ritmo)"
                        >
                          Invest. diário
                        </th>
                        <th
                          className="px-4 py-2 text-right font-medium"
                          title="Quanto investir por dia pra alcançar o Ideal até hoje, contando o que já foi gasto hoje: dentro de 80%–120% do ideal = investimento diário normal (Investimento mensal ÷ dias do mês); fora da faixa, ajusta pela diferença pro ideal, limitada a ±50% do normal"
                        >
                          Ritmo
                        </th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ acc, binding, insight }) => {
                        const priorityOption = priorityOptions.find((p) => p.id === binding?.priority);
                        const rowRitmo = ritmoFromInsight(binding?.monthly_investment, monthlyInsights[acc.account_id]);
                        const isPinned = pinnedIds.includes(acc.account_id);
                        const blur = hasPinned && !isPinned ? PIN_BLUR : "";
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
                            className={`group border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                              draggedAccountId === acc.account_id ? "opacity-40" : ""
                            } ${isPinned ? "bg-amber-50/70 dark:bg-amber-950/30" : ""}`}
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
                              <PinCell pinned={isPinned} onToggle={() => togglePin(acc.account_id)} />
                            </td>
                            <td className="px-4 py-2">
                              <OptimizedCell
                                optimized={!!binding?.optimized}
                                onToggle={(next) => patchBinding(acc.account_id, { optimized: next })}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <ClientNameHover
                                name={binding?.client_name || acc.name}
                                whatsapp={binding?.whatsapp_contact}
                                monthlyInvestment={binding?.monthly_investment}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <a
                                href={adsManagerUrl(acc.account_id, preset)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={
                                  paymentErrorIds.has(acc.account_id)
                                    ? "Conta com erro no pagamento"
                                    : lowBalanceIds.has(acc.account_id)
                                      ? "Saldo baixo"
                                      : "Abrir no Gerenciador de Anúncios"
                                }
                                className={`underline decoration-dotted underline-offset-2 ${
                                  paymentErrorIds.has(acc.account_id)
                                    ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                    : lowBalanceIds.has(acc.account_id)
                                      ? "text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                                }`}
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
                            <td className={`px-4 py-2 text-right tabular-nums ${blur}`}>{fmtCurrency(insight?.spend ?? 0)}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${blur}`}>{insight?.results ?? "—"}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${blur}`}>
                              {(() => {
                                const cpaActual = insight?.cost_per_result;
                                const cpaTarget = binding?.cpa_target;
                                const diff = cpaActual != null && cpaTarget != null ? cpaActual - cpaTarget : null;
                                const colorClass = cpaDiffColorClass(diff);
                                return (
                                  <>
                                    <div className={`text-base font-semibold ${colorClass}`}>{fmtCurrency(cpaActual)}</div>
                                    {diff != null ? (
                                      <div className={`text-xs opacity-70 ${colorClass}`}>{fmtCurrencySigned(diff)}</div>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-xs text-zinc-400">R$</span>
                                <InlineNumber
                                  value={binding?.cpa_target ?? null}
                                  onSave={(v) => patchBinding(acc.account_id, { cpa_target: v })}
                                  width="w-10"
                                  align="left"
                                />
                              </div>
                            </td>
                            <td className={`px-4 py-2 text-right tabular-nums ${blur}`}>
                              {(() => {
                                const diff = rowRitmo != null ? (insight?.daily_budget ?? 0) - rowRitmo : null;
                                const colorClass = ritmoColorClass(rowRitmo, insight?.daily_budget);
                                return (
                                  <>
                                    <div className={`text-base font-semibold ${colorClass}`}>
                                      {fmtCurrency(insight?.daily_budget ?? 0)}
                                    </div>
                                    {diff != null ? (
                                      <div className={`text-xs opacity-70 ${colorClass}`}>{fmtCurrencySigned(diff)}</div>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </td>
                            <td
                              className={`px-4 py-2 text-right tabular-nums ${blur}`}
                              title={ritmoTooltip(binding?.monthly_investment, monthlyInsights[acc.account_id])}
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
                cpaTargets={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.binding?.cpa_target ?? null]))}
                priorities={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.binding?.priority ?? null]))}
              />
            ) : null}

            {tab === "metas" ? (
              <MetasTab
                accounts={selectedAccounts}
                clientNames={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.clientName]))}
                cpaTargets={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.binding?.cpa_target ?? null]))}
                monthlyTargets={Object.fromEntries(
                  allRows.map((r) => [r.acc.account_id, r.binding?.monthly_investment ?? null]),
                )}
              />
            ) : null}

            {tab === "monitor-cpa" ? (
              <MonitorCpaTab
                accounts={selectedAccounts}
                clientNames={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.clientName]))}
                cpaTargets={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.binding?.cpa_target ?? null]))}
              />
            ) : null}

            {tab === "saldo" ? (
              <ControleSaldo
                accounts={selectedAccounts}
                clientNames={Object.fromEntries(allRows.map((r) => [r.acc.account_id, r.clientName]))}
                pixByAccount={pixAccounts}
                insights={insights}
                onPatch={patchPix}
                onRefresh={loadAccounts}
                refreshing={loadingAccounts}
              />
            ) : null}

            {tab === "analise" ? (
              <AnaliseTab
                accounts={selectedAccounts}
                initialFilters={uiState?.analise}
                onFiltersChange={handleAnaliseFiltersChange}
              />
            ) : null}

            {tab === "copy" ? <CopyTab accounts={selectedAccounts} bindings={bindings} /> : null}
            </>
            )}
          </div>
      </div>

      <ContasExibidasDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedIds={selectedIds ?? []}
        onSave={saveSelectedAccounts}
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
