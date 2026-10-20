"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dropTabCachePrefix, fmtCacheTime, isFresh, readTabCache, writeTabCache } from "@/lib/client-cache";

// Etapa 124: a Análise gera listas pra AGIR (pausar/aumentar orçamento) — o backup vale só 15 min
// e é apagado depois de qualquer ação, pra nunca agir em cima de lista velha.
const ANALISE_FRESH_MS = 15 * 60 * 1000;
import type { AdAccount } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { AumentoProgramado } from "@/components/painel/aumento-programado";
import { ExameTab } from "@/components/painel/exame-tab";
import { PublicoTab } from "@/components/painel/publico-tab";
import { VideosGeral } from "@/components/painel/videos-geral";
import { DuplicarConjuntoDialog, type DuplicateAdsetInput } from "@/components/painel/duplicar-conjunto-dialog";

// "Últimos 3 dias + hoje" (padrão recomendado — pega problema recente
// rápido) já vem primeiro em DATE_PRESETS, junto com os demais períodos
// usados no resto do Painel.
const ANALYSIS_PRESETS = DATE_PRESETS;

// Pausa entre cada chamada de uma ação em massa (Etapa 33, aumentada pra
// 3s na Etapa 34 a pedido) — espaça as requisições pra Graph API em vez de
// disparar tudo de uma vez, reduzindo a chance de bater no limite de
// chamadas da Meta por conta/app. Soma ao tempo de retry (com backoff bem
// maior pra rate limit) que já existe em metaPost — prioriza terminar
// direito a demorar mais.
const BULK_DELAY_MS = 3000;
// Tempo que o botão de ação em massa fica "armado" (2º clique confirma)
// antes de voltar sozinho ao estado normal, se ninguém confirmar.
const BULK_ARM_MS = 5000;

type AnalysisMode = "above" | "below";

// Etapa 41: Conjuntos e Criativos (só existem os dois na aba "acima da
// meta") viram duas telas separadas, alternadas por um botão igual ao de
// "CPA acima da meta"/"CPA abaixo da meta" — em vez das duas ficarem
// empilhadas na mesma tela. Na aba "abaixo da meta" só existe Conjuntos,
// então o botão nem aparece lá.
type SubPanel = "conjuntos" | "criativos";

interface AdRow {
  id: string;
  name: string;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
  // Etapa 40: média fixa dos últimos 7 dias (independente do período
  // escolhido na tela) — só preenchida na aba "acima da meta", usada pra
  // destacar a linha em verde quando já está abaixo da Meta CPA.
  avg_cost_7d?: number | null;
}

interface AdSetRow {
  id: string;
  name: string;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  ads: AdRow[];
  avg_cost_7d?: number | null;
  // Etapa 46: conjunto ativo sem nenhum anúncio ativo dentro dele — quando
  // false, o conjunto pode ter entrado na lista só por isso (sem bater o
  // limite de CPA).
  has_active_ad?: boolean;
  // Etapa 128: data de criação do conjunto (ISO)
  created_time?: string | null;
}

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  adsets: AdSetRow[];
}

interface CreativeRow {
  id: string;
  name: string;
  adset_name: string | null;
  // Etapa 127: data de criação do conjunto (ISO)
  adset_created_time?: string | null;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
  avg_cost_7d?: number | null;
}

interface CreativeGroup {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  ads: CreativeRow[];
}

interface Skipped {
  accountId: string;
  clientName: string;
}

interface BulkError {
  name: string;
  error: string;
}

function statusLabel(status: string | null): string {
  const s = status?.toUpperCase();
  if (s === "ACTIVE") return "Ativo";
  if (s === "PAUSED") return "Pausado";
  return status || "—";
}

// Mesmo cálculo de "Diferença" usado em conjunto e criativo: sem conversa, o
// sinal vira o próprio gasto acima da Meta CPA; com conversa, é custo por
// conversa menos a Meta CPA. Negativo = abaixo da meta.
// Etapa 127: filtro da tela Criativos. Trabalha só em cima do que já foi buscado (sem nova consulta à Meta).
// "Acima de R$10/R$15" = a DIFERENÇA da coluna (CPA do criativo menos a Meta CPA da conta) maior que esse valor —
// ou seja, quanto ele está acima da meta, não o CPA em si. "Todos" é o padrão e fica sempre fixo.
type CreativeFilterId = "all" | "none" | "le10" | "gt10" | "gt15";
const CREATIVE_FILTERS: Array<{ id: CreativeFilterId; label: string; match: (a: CreativeRow, cpaTarget: number) => boolean }> = [
  { id: "all", label: "Todos", match: () => true },
  { id: "none", label: "Sem resultado", match: (a) => !a.conversations || a.conversations <= 0 },
  {
    id: "le10",
    label: "Até R$ 10,00",
    match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) <= 10,
  },
  {
    id: "gt10",
    label: "Acima de R$10",
    match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) > 10,
  },
  {
    id: "gt15",
    label: "Acima de R$15",
    match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) > 15,
  },
];

// Etapa 128: filtro da tela Conjuntos (só em "acima da meta"). Também só trabalha no que já está na tela.
// "Até R$ X" = a DIFERENÇA da coluna (CPA do conjunto menos a Meta CPA da conta) menor ou igual a X; "Acima de R$ 20,00"
// = maior que 20. "Sem anúncio ativo" é o antigo checkbox "Só sem anúncio ativo". "Todos" é o padrão e fica fixo.
type AdsetFilterId = "all" | "noad" | "le10" | "le15" | "le20" | "gt20";
const ADSET_FILTERS: Array<{ id: AdsetFilterId; label: string; match: (a: AdSetRow, cpaTarget: number) => boolean }> = [
  { id: "all", label: "Todos", match: () => true },
  { id: "noad", label: "Sem anúncio ativo", match: (a) => a.has_active_ad === false },
  { id: "le10", label: "Até R$ 10,00", match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) <= 10 },
  { id: "le15", label: "Até R$ 15,00", match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) <= 15 },
  { id: "le20", label: "Até R$ 20,00", match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) <= 20 },
  { id: "gt20", label: "Acima de R$ 20,00", match: (a, t) => diffFor(a.spend, a.conversations, a.cost_per_conversation, t) > 20 },
];

// Data de criação do conjunto, no fuso de Brasília: "12/10/26" (o horário completo fica no tooltip).
function fmtAdsetDate(iso?: string | null): { short: string; full: string } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const tz = "America/Sao_Paulo";
  return {
    short: new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit" }).format(t),
    full: new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(t),
  };
}

function diffFor(spend: number, conversations: number | null, costPerConversation: number | null, cpaTarget: number) {
  const noConversion = !conversations || conversations <= 0;
  return noConversion ? spend - cpaTarget : (costPerConversation ?? 0) - cpaTarget;
}

function fmtDiffSigned(diff: number): string {
  return `${diff >= 0 ? "+" : "-"}${fmtCurrency(Math.abs(diff))}`;
}

// Etapa 40: linha com média fixa dos últimos 7 dias já abaixo da Meta CPA —
// destaque verde sutil (só o fundo, sem exagerar), sinalizando "esse já pode
// estar melhorando" mesmo que o período escolhido na tela ainda mostre acima.
function goodTrend(avgCost7d: number | null | undefined, cpaTarget: number): boolean {
  return avgCost7d != null && avgCost7d < cpaTarget;
}
const GOOD_TREND_CLASS = "bg-emerald-50/70 dark:bg-emerald-950/20";
const GOOD_TREND_TITLE = "Média dos últimos 7 dias já está abaixo da Meta CPA";

// Extraído (Etapa 40) pra não repetir a mesma lógica de "arma → confirma →
// roda um de cada vez com pausa → junta erros" três vezes (conjuntos da aba
// abaixo da meta, conjuntos e criativos da aba acima da meta agora são três
// listas independentes, cada uma com seu próprio botão de ação em massa).
function useBulkRunner<T>() {
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<BulkError[]>([]);
  const armTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    setArmed(true);
    if (armTimeout.current) clearTimeout(armTimeout.current);
    armTimeout.current = setTimeout(() => setArmed(false), BULK_ARM_MS);
  }, []);

  const disarm = useCallback(() => {
    setArmed(false);
    if (armTimeout.current) clearTimeout(armTimeout.current);
  }, []);

  const run = useCallback(
    async (
      targets: T[],
      getName: (t: T) => string,
      action: (t: T) => Promise<{ ok: true } | { ok: false; error: string }>,
    ) => {
      if (armTimeout.current) clearTimeout(armTimeout.current);
      setArmed(false);
      if (targets.length === 0) return;
      setRunning(true);
      setErrors([]);
      setProgress({ done: 0, total: targets.length });
      const errs: BulkError[] = [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        try {
          const result = await action(t);
          if (!result.ok) errs.push({ name: getName(t), error: result.error });
        } catch (e) {
          errs.push({ name: getName(t), error: (e as Error).message });
        }
        setProgress({ done: i + 1, total: targets.length });
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
      }
      setRunning(false);
      setProgress(null);
      setErrors(errs);
    },
    [],
  );

  return { armed, running, progress, errors, arm, disarm, run, setErrors };
}

// Só os campos que os componentes de UI abaixo (BulkBar/BulkErrorsBanner)
// realmente leem — evita depender do genérico <T> de useBulkRunner (que
// varia por lista) na assinatura dos props.
interface BulkUiState {
  armed: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  errors: BulkError[];
  arm: () => void;
  disarm: () => void;
  setErrors: (errors: BulkError[]) => void;
}

// Cabeçalho de ação em massa reutilizado pelas 3 listas (conjuntos "abaixo
// da meta", conjuntos e criativos "acima da meta") — só muda o texto, a cor
// quando armado e o handler. Fora do componente de propósito (componente
// declarado dentro de outro perde o estado a cada render).
function BulkBar({
  label,
  count,
  verb,
  bulk,
  disabled,
  onConfirm,
}: {
  label: string;
  count: number;
  verb: string;
  bulk: BulkUiState;
  disabled: boolean;
  onConfirm: () => void;
}) {
  if (count === 0 && !bulk.running) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/60 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-800/20">
      {bulk.running && bulk.progress ? (
        <span className="text-xs text-zinc-600 dark:text-zinc-300">
          {verb} {bulk.progress.done} de {bulk.progress.total}
          {bulk.progress.done < bulk.progress.total ? "… (uma chamada por vez, de propósito)" : "…"}
        </span>
      ) : (
        <>
          <button
            onClick={() => (bulk.armed ? onConfirm() : bulk.arm())}
            disabled={count === 0 || disabled}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
              bulk.armed
                ? "border-red-400 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {bulk.armed ? `Confirma ${label.toLowerCase()} (${count})?` : `${label} (${count})`}
          </button>
          {bulk.armed ? (
            <button
              onClick={bulk.disarm}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
            >
              Cancelar
            </button>
          ) : null}
          {bulk.armed ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Clique de novo pra confirmar — some sozinho em {BULK_ARM_MS / 1000}s.
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function BulkErrorsBanner({ bulk, verb }: { bulk: BulkUiState; verb: string }) {
  if (bulk.errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {bulk.errors.length} {verb} nessa leva:
        </span>
        <button onClick={() => bulk.setErrors([])} className="text-amber-700 hover:underline dark:text-amber-300">
          dispensar
        </button>
      </div>
      <ul className="list-disc space-y-0.5 pl-4">
        {bulk.errors.map((be, i) => (
          <li key={i}>
            <span className="font-medium">{be.name}:</span> {be.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface AnaliseFilters {
  mode: AnalysisMode;
  subPanel: SubPanel;
  preset: string;
  search: string;
  noActiveAdOnly: boolean;
}

function AnaliseTabInner({
  accounts,
  initialFilters,
  onFiltersChange,
}: {
  accounts: AdAccount[];
  // Etapa 39: filtros salvos da última vez (Supabase, via painel-ui-state)
  // — pra voltar do jeito que estava depois de um F5, em vez de sempre
  // reabrir em "acima da meta"/"últimos 3 dias"/busca vazia. Vem como
  // objeto solto (Record) do estado salvo — validado campo a campo abaixo
  // em vez de confiar no formato de propósito.
  initialFilters?: Record<string, unknown>;
  onFiltersChange?: (filters: AnaliseFilters) => void;
}) {
  const [mode, setMode] = useState<AnalysisMode>(
    initialFilters?.mode === "above" || initialFilters?.mode === "below" ? initialFilters.mode : "above",
  );
  const [subPanel, setSubPanel] = useState<SubPanel>(
    initialFilters?.subPanel === "criativos" ? "criativos" : "conjuntos",
  );
  const [preset, setPreset] = useState(
    typeof initialFilters?.preset === "string" ? initialFilters.preset : "last_3d_plus_today",
  );
  const [search, setSearch] = useState(typeof initialFilters?.search === "string" ? initialFilters.search : "");
  // Etapa 78: filtro pra ver só os conjuntos "Sem anúncio ativo" (mesmo
  // critério do badge acima) dentro de Conjuntos > acima da meta — em vez de
  // precisar caçar o badge no meio dos outros. Junto com isso, os conjuntos
  // "Sem anúncio ativo" agora sempre aparecem primeiro dentro de cada conta,
  // com um divisor, mesmo sem o filtro ligado.
  const [noActiveAdOnly, setNoActiveAdOnly] = useState(
    typeof initialFilters?.noActiveAdOnly === "boolean" ? initialFilters.noActiveAdOnly : false,
  );

  // Conjuntos — usado nas duas abas ("acima" e "abaixo" da meta).
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Criativos (Etapa 40) — sub-painel novo, só existe na aba "acima da meta".
  const [creativeGroups, setCreativeGroups] = useState<CreativeGroup[] | null>(null);
  const [creativeLoading, setCreativeLoading] = useState(false);
  const [creativeError, setCreativeError] = useState<string | null>(null);

  const [actingId, setActingId] = useState<string | null>(null);
  // Etapa 159: conjunto aberto na janelinha "Duplicar".
  const [dupTarget, setDupTarget] = useState<DuplicateAdsetInput | null>(null);
  const [increasedIds, setIncreasedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Etapa 42: caixa de seleção pra agir só em quem foi marcado, em vez de
  // sempre todos os listados. Existia só nas duas telas de pausar
  // (Conjuntos e Criativos da aba "acima da meta"); Etapa 62 estendeu o
  // mesmo seletor pra Conjuntos "abaixo da meta" (aumentar orçamento),
  // pedido explícito pra ficar igual à tela "acima da meta". "Todos os
  // listados" continua existindo do lado, sem checkbox nenhum marcado.
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set());
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());
  // Etapa 127: filtro da lista de criativos — só esconde/mostra o que JÁ está na tela (nenhuma busca nova).
  const [creativeFilter, setCreativeFilter] = useState<CreativeFilterId>("all");
  // Etapa 128: filtro de valor dos conjuntos (o "Sem anúncio ativo" continua sendo o noActiveAdOnly, salvo junto com as outras escolhas)
  const [adsetValueFilter, setAdsetValueFilter] = useState<AdsetFilterId>("all");

  // Seis ações em massa independentes: conjuntos "abaixo da meta" — todos
  // listados e só selecionados (aumentar orçamento); conjuntos "acima da
  // meta" — todos listados e só selecionados (pausar); criativos "acima da
  // meta" — todos listados e só selecionados (pausar).
  const belowBulk = useBulkRunner<AdSetRow>();
  const belowSelectedBulk = useBulkRunner<AdSetRow>();
  const aboveAdsetBulk = useBulkRunner<AdSetRow>();
  const aboveAdsetSelectedBulk = useBulkRunner<AdSetRow>();
  const aboveCreativeBulk = useBulkRunner<CreativeRow>();
  const aboveCreativeSelectedBulk = useBulkRunner<CreativeRow>();

  useEffect(() => {
    onFiltersChange?.({ mode, subPanel, preset, search, noActiveAdOnly });
  }, [mode, subPanel, preset, search, noActiveAdOnly, onFiltersChange]);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a.name])), [accounts]);

  const [analiseAt, setAnaliseAt] = useState<number | null>(null);
  const loadAdsets = useCallback(async (force = false) => {
    if (accounts.length === 0) {
      setGroups([]);
      return;
    }
    const key = `analise-adsets-v2:${mode}:${preset}:${accounts.map((a) => a.account_id).join(",")}`;
    const backup = readTabCache<{ groups: Group[]; skipped: typeof skipped }>(key);
    if (backup) {
      setGroups(backup.data.groups);
      setSkipped(backup.data.skipped);
      setAnaliseAt(backup.at);
      if (!force && isFresh(backup, ANALISE_FRESH_MS)) return;
    } else {
      setAnaliseAt(null);
    }
    setLoading(true);
    setError(null);
    let d: { error?: string; groups?: Group[]; skipped?: typeof skipped };
    try {
      const res = await fetch("/api/analysis/adsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: accounts.map((a) => a.account_id),
          datePreset: preset,
          mode,
        }),
      });
      d = await res.json();
    } catch (e) {
      d = { error: (e as Error).message };
    }
    setLoading(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setAnaliseAt(writeTabCache(key, { groups: d.groups ?? [], skipped: d.skipped ?? [] }));
    setGroups(d.groups ?? []);
    setSkipped(d.skipped ?? []);
    setIncreasedIds(new Set());
    setSelectedAdsetIds(new Set());
  }, [accounts, preset, mode]);

  // Criativos só existem na aba "acima da meta" — não busca nada na
  // "abaixo da meta", pra não gastar chamada à toa com o que não aparece.
  const loadCreatives = useCallback(async (force = false) => {
    if (mode !== "above" || accounts.length === 0) {
      setCreativeGroups(mode !== "above" ? null : []);
      return;
    }
    const key = `analise-creatives-v2:${preset}:${accounts.map((a) => a.account_id).join(",")}`;
    const backup = readTabCache<{ groups: CreativeGroup[]; skipped: typeof skipped }>(key);
    if (backup) {
      setCreativeGroups(backup.data.groups);
      setSkipped(backup.data.skipped);
      setAnaliseAt(backup.at);
      if (!force && isFresh(backup, ANALISE_FRESH_MS)) return;
    }
    setCreativeLoading(true);
    setCreativeError(null);
    let d: { error?: string; groups?: CreativeGroup[]; skipped?: typeof skipped };
    try {
      const res = await fetch("/api/analysis/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: accounts.map((a) => a.account_id),
          datePreset: preset,
        }),
      });
      d = await res.json();
    } catch (e) {
      d = { error: (e as Error).message };
    }
    setCreativeLoading(false);
    if (d.error) {
      setCreativeError(d.error);
      return;
    }
    setAnaliseAt(writeTabCache(key, { groups: d.groups ?? [], skipped: d.skipped ?? [] }));
    setCreativeGroups(d.groups ?? []);
    // Mesma checagem de "conta sem Meta CPA cadastrada" do lado de Conjuntos
    // — atualiza o aviso mesmo quando quem buscou por último foi a tela de
    // Criativos.
    setSkipped(d.skipped ?? []);
    setSelectedCreativeIds(new Set());
  }, [accounts, preset, mode]);

  // Etapa 41: só busca a tela que está sendo exibida (economiza chamada à
  // Meta Graph API) — Conjuntos e Criativos viraram telas alternadas, não
  // duas listas na mesma tela. Em "abaixo da meta" só existe Conjuntos.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca a análise ao trocar contas/período/aba/tela exibida
    if (mode === "below" || subPanel === "conjuntos") void loadAdsets(false);
    if (mode === "above" && subPanel === "criativos") void loadCreatives(false);
  }, [loadAdsets, loadCreatives, mode, subPanel]);

  // Desarma os botões em massa sozinho ao trocar de aba/tela/período — evita
  // confirmar sem querer uma ação pensada pra outra lista.
  //
  // Importante: essas variáveis "disarmX" guardam só a FUNÇÃO disarm de
  // cada um (estável entre renders, via useCallback dentro de
  // useBulkRunner) — nunca o objeto "belowBulk"/"aboveAdsetBulk"/etc.
  // inteiro. Esse objeto é recriado a cada render do componente (é um
  // literal `{ armed, running, ... }` novo toda vez), então usar ele
  // direto (ou colocá-lo nas dependências do efeito abaixo) fazia esse
  // efeito rodar de novo a cada render, inclusive o render disparado pelo
  // próprio clique em "arm" — ou seja, o botão "armava" (ficava vermelho)
  // e no mesmo instante esse efeito rodava de novo e desarmava sozinho,
  // sem nem dar tempo do segundo clique de confirmação (bug real
  // corrigido depois de relato).
  const disarmBelow = belowBulk.disarm;
  const disarmBelowSelected = belowSelectedBulk.disarm;
  const disarmAboveAdset = aboveAdsetBulk.disarm;
  const disarmAboveAdsetSelected = aboveAdsetSelectedBulk.disarm;
  const disarmAboveCreative = aboveCreativeBulk.disarm;
  const disarmAboveCreativeSelected = aboveCreativeSelectedBulk.disarm;

  useEffect(() => {
    disarmBelow();
    disarmBelowSelected();
    disarmAboveAdset();
    disarmAboveAdsetSelected();
    disarmAboveCreative();
    disarmAboveCreativeSelected();
  }, [
    mode,
    subPanel,
    preset,
    disarmBelow,
    disarmBelowSelected,
    disarmAboveAdset,
    disarmAboveAdsetSelected,
    disarmAboveCreative,
    disarmAboveCreativeSelected,
  ]);

  function toggleAdsetSelected(id: string) {
    setSelectedAdsetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCreativeSelected(id: string) {
    setSelectedCreativeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(adsetId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(adsetId)) next.delete(adsetId);
      else next.add(adsetId);
      return next;
    });
  }

  // Isolado de propósito (pedido explícito): só pausa o criativo, mesma
  // chamada simples de /api/meta/status já usada em Visão Geral — sem mexer
  // no conjunto. Sem popup de confirmação (pedido explícito também). Usado
  // pelos criativos expandidos DENTRO de um conjunto (sub-painel Conjuntos).
  async function pauseCreative(ad: AdRow, adsetId: string) {
    dropTabCachePrefix("analise-");
    setActingId(ad.id);
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: ad.id, type: "ad" }], status: "PAUSED" }),
    });
    const d = await res.json();
    setActingId(null);
    const result = d.results?.[0];
    if (!result?.ok) {
      alert(result?.error ?? "Não foi possível pausar o criativo.");
      return;
    }
    setGroups((prev) =>
      prev
        ? prev.map((g) => ({
            ...g,
            adsets: g.adsets.map((as) =>
              as.id === adsetId
                ? { ...as, ads: as.ads.map((a) => (a.id === ad.id ? { ...a, status: "PAUSED" } : a)) }
                : as,
            ),
          }))
        : prev,
    );
  }

  // Isolado de propósito: só pausa o conjunto inteiro, mesma chamada simples
  // de /api/meta/status já usada em Visão Geral — sem renomear nem duplicar
  // nada. Some da lista ao pausar, já que deixa de ser um conjunto ativo pra
  // sinalizar aqui.
  async function pauseOneAdSet(adset: AdSetRow): Promise<{ ok: true } | { ok: false; error: string }> {
    dropTabCachePrefix("analise-");
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: adset.id, type: "adset" }], status: "PAUSED" }),
    });
    const d = await res.json();
    const result = d.results?.[0];
    if (!result?.ok) return { ok: false, error: result?.error ?? "Erro desconhecido" };
    setGroups((prev) =>
      prev
        ? prev.map((g) => ({ ...g, adsets: g.adsets.filter((as) => as.id !== adset.id) })).filter((g) => g.adsets.length > 0)
        : prev,
    );
    return { ok: true };
  }

  // Novo (Etapa 40): pausa um criativo do sub-painel Criativos — mesma
  // chamada simples, mas opera na lista plana (creativeGroups), não na
  // nested de dentro de um conjunto.
  async function pauseOneCreativeStandalone(ad: CreativeRow): Promise<{ ok: true } | { ok: false; error: string }> {
    dropTabCachePrefix("analise-");
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: ad.id, type: "ad" }], status: "PAUSED" }),
    });
    const d = await res.json();
    const result = d.results?.[0];
    if (!result?.ok) return { ok: false, error: result?.error ?? "Erro desconhecido" };
    setCreativeGroups((prev) =>
      prev ? prev.map((g) => ({ ...g, ads: g.ads.filter((a) => a.id !== ad.id) })).filter((g) => g.ads.length > 0) : prev,
    );
    return { ok: true };
  }


  // Só na aba "abaixo da meta": aumenta o orçamento diário do conjunto em
  // R$2,50 fixo. Fica marcado como "Aumentado" (e o botão trava) até a
  // próxima atualização, pra não dar dois cliques sem querer.
  async function increaseOneBudget(adset: AdSetRow): Promise<{ ok: true } | { ok: false; error: string }> {
    dropTabCachePrefix("analise-");
    const res = await fetch("/api/analysis/increase-budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adsetId: adset.id }),
    });
    const d = await res.json();
    if (!d.ok) return { ok: false, error: d.error ?? "Erro desconhecido" };
    setIncreasedIds((prev) => new Set(prev).add(adset.id));
    return { ok: true };
  }

  async function increaseBudget(adset: AdSetRow) {
    setActingId(adset.id);
    const result = await increaseOneBudget(adset);
    setActingId(null);
    if (!result.ok) alert(result.error);
  }

  // Busca por nome — de propósito global: filtra o conjunto (ou a campanha)
  // em qualquer conta/cliente ao mesmo tempo, não só dentro de um grupo.
  const q = search.trim().toLowerCase();
  // Etapa 78: filtro "Só sem anúncio ativo" só faz sentido em Conjuntos >
  // acima da meta (onde o badge existe) — nas demais telas fica sempre
  // desligado, mesmo que o estado continue marcado por trás.
  const noActiveAdFilterActive = mode === "above" && subPanel === "conjuntos" && noActiveAdOnly;
  // Etapa 78: em Conjuntos > acima da meta, os "Sem anúncio ativo" sempre
  // vêm primeiro dentro de cada conta (com um divisor na renderização),
  // mantendo a ordem por gravidade (sortKey da API) dentro de cada grupo —
  // não mistura mais os dois pra achar o badge no meio da lista.
  const separateNoActiveAd = mode === "above" && subPanel === "conjuntos";
  // Etapa 128: lista depois da busca por nome, ANTES do filtro de valor — base dos contadores dos botões.
  const searchedGroups = (groups ?? []).map((g) => ({
    ...g,
    adsets: g.adsets.filter((as) => !q || as.name.toLowerCase().includes(q) || (as.campaign_name ?? "").toLowerCase().includes(q)),
  }));
  const adsetFilterId: AdsetFilterId = noActiveAdFilterActive ? "noad" : separateNoActiveAd ? adsetValueFilter : "all";
  const adsetFilterCounts: Record<AdsetFilterId, number> = { all: 0, noad: 0, le10: 0, le15: 0, le20: 0, gt20: 0 };
  for (const g of searchedGroups) {
    for (const as of g.adsets) {
      for (const f of ADSET_FILTERS) if (f.match(as, g.cpaTarget)) adsetFilterCounts[f.id]++;
    }
  }
  const activeAdsetFilter = ADSET_FILTERS.find((f) => f.id === adsetFilterId) ?? ADSET_FILTERS[0];
  const filteredGroups = searchedGroups
    .map((g) => {
      const adsets = g.adsets.filter((as) => activeAdsetFilter.match(as, g.cpaTarget));
      return {
        ...g,
        adsets: separateNoActiveAd
          ? [...adsets.filter((as) => as.has_active_ad === false), ...adsets.filter((as) => as.has_active_ad !== false)]
          : adsets,
      };
    })
    .filter((g) => g.adsets.length > 0);

  // Lista depois da busca por nome, ANTES do filtro de valor — é a base dos contadores dos botões do filtro.
  const searchedCreativeGroups = (creativeGroups ?? []).map((g) => ({
    ...g,
    ads: q
      ? g.ads.filter((a) => a.name.toLowerCase().includes(q) || (a.campaign_name ?? "").toLowerCase().includes(q))
      : g.ads,
  }));
  const creativeFilterCounts: Record<CreativeFilterId, number> = { all: 0, none: 0, le10: 0, gt10: 0, gt15: 0 };
  for (const g of searchedCreativeGroups) {
    for (const a of g.ads) {
      for (const f of CREATIVE_FILTERS) if (f.match(a, g.cpaTarget)) creativeFilterCounts[f.id]++;
    }
  }
  const activeCreativeFilter = CREATIVE_FILTERS.find((f) => f.id === creativeFilter) ?? CREATIVE_FILTERS[0];
  const filteredCreativeGroups = searchedCreativeGroups
    .map((g) => ({ ...g, ads: g.ads.filter((a) => activeCreativeFilter.match(a, g.cpaTarget)) }))
    .filter((g) => g.ads.length > 0);

  const totalAdsets = filteredGroups.reduce((s, g) => s + g.adsets.length, 0);
  const totalCreatives = filteredCreativeGroups.reduce((s, g) => s + g.ads.length, 0);

  // Na aba "abaixo da meta" a ação em massa pula quem já foi aumentado
  // individualmente (ou por um lote anterior) nessa mesma tela.
  const belowBulkTargets = filteredGroups.flatMap((g) => g.adsets.filter((as) => !increasedIds.has(as.id)));
  const aboveAdsetBulkTargets = filteredGroups.flatMap((g) => g.adsets);
  const aboveCreativeBulkTargets = filteredCreativeGroups.flatMap((g) => g.ads);

  // Etapa 42 (e Etapa 62, estendido pra "abaixo da meta"): dentro dos mesmos
  // listados acima, só quem tem a caixinha marcada — usado pelo botão
  // "Pausar selecionados"/"Aumentar selecionados", ao lado do "Todos os
  // listados" (que continua igual, ignorando a seleção). Mesmo Set
  // (selectedAdsetIds) serve pras duas abas porque só uma tela de Conjuntos
  // fica visível por vez, e a seleção já reseta sozinha a cada busca nova
  // (loadAdsets, inclusive ao trocar de aba).
  const belowSelectedTargets = belowBulkTargets.filter((a) => selectedAdsetIds.has(a.id));
  const aboveAdsetSelectedTargets = aboveAdsetBulkTargets.filter((a) => selectedAdsetIds.has(a.id));
  const aboveCreativeSelectedTargets = aboveCreativeBulkTargets.filter((a) => selectedCreativeIds.has(a.id));
  const allBelowAdsetsSelected = belowBulkTargets.length > 0 && belowBulkTargets.every((a) => selectedAdsetIds.has(a.id));
  const allAdsetsSelected = aboveAdsetBulkTargets.length > 0 && aboveAdsetBulkTargets.every((a) => selectedAdsetIds.has(a.id));
  const allCreativesSelected =
    aboveCreativeBulkTargets.length > 0 && aboveCreativeBulkTargets.every((a) => selectedCreativeIds.has(a.id));

  function toggleAllBelowAdsetsSelected() {
    setSelectedAdsetIds(allBelowAdsetsSelected ? new Set() : new Set(belowBulkTargets.map((a) => a.id)));
  }
  function toggleAllAdsetsSelected() {
    setSelectedAdsetIds(allAdsetsSelected ? new Set() : new Set(aboveAdsetBulkTargets.map((a) => a.id)));
  }
  function toggleAllCreativesSelected() {
    setSelectedCreativeIds(allCreativesSelected ? new Set() : new Set(aboveCreativeBulkTargets.map((a) => a.id)));
  }

  // "Ocupado" por lista — trava o botão "todos" enquanto "selecionados"
  // roda (e vice-versa), pra não disparar as duas ações em massa da mesma
  // lista ao mesmo tempo.
  const belowBusy = belowBulk.running || belowSelectedBulk.running;
  const aboveAdsetBusy = aboveAdsetBulk.running || aboveAdsetSelectedBulk.running;
  const aboveCreativeBusy = aboveCreativeBulk.running || aboveCreativeSelectedBulk.running;

  const controlsDisabled =
    loading ||
    creativeLoading ||
    belowBulk.running ||
    belowSelectedBulk.running ||
    aboveAdsetBulk.running ||
    aboveAdsetSelectedBulk.running ||
    aboveCreativeBulk.running ||
    aboveCreativeSelectedBulk.running;

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <div className="mb-2 inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
            <button
              onClick={() => setMode("above")}
              disabled={controlsDisabled}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                mode === "above"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              CPA acima da meta
            </button>
            <button
              onClick={() => setMode("below")}
              disabled={controlsDisabled}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                mode === "below"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              CPA abaixo da meta
            </button>
          </div>
          {mode === "above" ? (
            <div className="mb-2 inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700 sm:ml-2">
              <button
                onClick={() => setSubPanel("conjuntos")}
                disabled={controlsDisabled}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                  subPanel === "conjuntos"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                Conjuntos
              </button>
              <button
                onClick={() => setSubPanel("criativos")}
                disabled={controlsDisabled}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                  subPanel === "criativos"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                Criativos
              </button>
            </div>
          ) : null}
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "above"
              ? subPanel === "criativos"
                ? "Custo por conversa iniciada, por criativo — acima da meta"
                : "Custo por conversa iniciada, por conjunto — acima da meta"
              : "Custo por conversa iniciada, por conjunto — abaixo da meta"}
            {(loading || creativeLoading) ? " · atualizando…" : ""}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">
            {mode === "above"
              ? subPanel === "criativos"
                ? "Custo por conversa R$4+ acima da Meta CPA, ou sem conversa com o próprio gasto R$4+ acima — limite mais " +
                  "sensível que o de Conjuntos, de propósito, pra pegar o problema no criativo cedo. Linha verde = média " +
                  "fixa dos últimos 7 dias já abaixo da Meta CPA. Nada é pausado sozinho."
                : "Custo por conversa no DOBRO da Meta CPA + R$1 (ou mais), ou sem conversa com o próprio gasto já nesse " +
                  "patamar — ou conjunto ativo sem nenhum anúncio ativo dentro dele (badge \"Sem anúncio ativo\"), " +
                  "independente do CPA. Duplo clique no conjunto mostra os criativos dele. Linha verde = média fixa " +
                  "dos últimos 7 dias já abaixo da Meta CPA. Nada é pausado sozinho."
              : "Só conjunto ativo, com pelo menos uma conversa iniciada no período e custo por conversa abaixo da Meta " +
                "CPA — candidato a receber mais investimento. Duplo clique no conjunto mostra os criativos dele. Nada é " +
                "alterado sozinho, os botões (individual ou em massa) são manuais."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={controlsDisabled}
            placeholder="Buscar conjunto/criativo/campanha…"
            className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            disabled={controlsDisabled}
            className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {ANALYSIS_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (mode === "below" || subPanel === "conjuntos") void loadAdsets(true);
              if (mode === "above" && subPanel === "criativos") void loadCreatives(true);
            }}
            disabled={controlsDisabled}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading || creativeLoading ? "Atualizando…" : "↻ Atualizar"}
          </button>
          {analiseAt && !(loading || creativeLoading) ? (
            <span className="text-xs text-zinc-400">atualizado às {fmtCacheTime(analiseAt)}</span>
          ) : null}
        </div>
      </div>

      {/* ─── Tela Conjuntos (as duas abas usam esse mesmo bloco; Etapa 41: */}
      {/* virou tela exclusiva, alternada com Criativos, em vez de empilhada) ─── */}
      {mode === "below" || subPanel === "conjuntos" ? (
      <div>
        {/* Etapa 128: filtro rápido da lista de conjuntos (não faz nova busca na Meta) */}
        {mode === "above" ? (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            <span className="text-xs text-zinc-400">Filtrar:</span>
            {ADSET_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setNoActiveAdOnly(f.id === "noad");
                  setAdsetValueFilter(f.id === "noad" ? "all" : f.id);
                }}
                disabled={controlsDisabled || aboveAdsetBusy}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  adsetFilterId === f.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {f.label} ({adsetFilterCounts[f.id]})
              </button>
            ))}
          </div>
        ) : null}
        <BulkBar
          label={mode === "above" ? "Pausar todos os conjuntos listados" : "Aumentar todos os orçamentos listados"}
          count={mode === "above" ? aboveAdsetBulkTargets.length : belowBulkTargets.length}
          verb={mode === "above" ? "Pausando" : "Aumentando"}
          bulk={mode === "above" ? aboveAdsetBulk : belowBulk}
          disabled={mode === "above" ? aboveAdsetBusy : belowBusy}
          onConfirm={() =>
            mode === "above"
              ? void aboveAdsetBulk.run(aboveAdsetBulkTargets, (a) => a.name, pauseOneAdSet)
              : void belowBulk.run(belowBulkTargets, (a) => a.name, increaseOneBudget)
          }
        />
        <BulkErrorsBanner
          bulk={mode === "above" ? aboveAdsetBulk : belowBulk}
          verb={mode === "above" ? "conjunto(s) não pausado(s)" : "conjunto(s) não aumentado(s)"}
        />

        {/* Etapa 42 (e Etapa 62: estendido pra "abaixo da meta", pedido */}
        {/* explícito pra ficar igual à tela "acima da meta") — agir só em */}
        {/* quem foi marcado na caixinha, nas duas abas. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={mode === "above" ? allAdsetsSelected : allBelowAdsetsSelected}
              onChange={mode === "above" ? toggleAllAdsetsSelected : toggleAllBelowAdsetsSelected}
              disabled={mode === "above" ? aboveAdsetBusy : belowBusy}
            />
            Selecionar todos os listados
          </label>
        </div>
        <BulkBar
          label={mode === "above" ? "Pausar selecionados" : "Aumentar selecionados"}
          count={mode === "above" ? aboveAdsetSelectedTargets.length : belowSelectedTargets.length}
          verb={mode === "above" ? "Pausando" : "Aumentando"}
          bulk={mode === "above" ? aboveAdsetSelectedBulk : belowSelectedBulk}
          disabled={mode === "above" ? aboveAdsetBusy : belowBusy}
          onConfirm={() =>
            mode === "above"
              ? void aboveAdsetSelectedBulk
                  .run(aboveAdsetSelectedTargets, (a) => a.name, pauseOneAdSet)
                  .then(() => setSelectedAdsetIds(new Set()))
              : void belowSelectedBulk
                  .run(belowSelectedTargets, (a) => a.name, increaseOneBudget)
                  .then(() => setSelectedAdsetIds(new Set()))
          }
        />
        <BulkErrorsBanner
          bulk={mode === "above" ? aboveAdsetSelectedBulk : belowSelectedBulk}
          verb={mode === "above" ? "conjunto(s) selecionado(s) não pausado(s)" : "conjunto(s) selecionado(s) não aumentado(s)"}
        />

        {error ? (
          <p className="px-4 py-6 text-sm text-red-600">{error}</p>
        ) : !groups ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
        ) : totalAdsets === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">
            {q
              ? "Nenhum conjunto encontrado com esse nome."
              : noActiveAdFilterActive
                ? "Nenhum conjunto sem anúncio ativo nesse período."
                : mode === "above" && adsetFilterId !== "all"
                  ? "Nenhum conjunto nesse filtro."
                : mode === "above"
                  ? "Nenhum conjunto ativo no dobro da meta + R$1 (ou mais), ou sem anúncio ativo, nesse período."
                  : "Nenhum conjunto ativo abaixo da meta nesse período."}
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredGroups.map((g) => (
              <div key={g.accountId}>
                <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-800/40">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{g.clientName}</span>
                  <a
                    href={adsManagerUrl(g.accountId, preset)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir no Gerenciador de Anúncios"
                    className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {accountNameById.get(g.accountId) ?? g.accountId}
                  </a>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Meta CPA: {fmtCurrency(g.cpaTarget)}</span>
                  <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {g.adsets.length} conjunto(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                        <th className="w-8 px-4 py-1.5"></th>
                        {mode === "above" ? (
                          <>
                            <th className="px-4 py-1.5 font-medium">Data</th>
                            <th className="px-4 py-1.5 font-medium">Conjunto</th>
                            <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                            <th className="px-4 py-1.5 text-right font-medium">CPA</th>
                            <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                            <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                          </>
                        ) : (
                          <>
                            <th className="px-4 py-1.5 font-medium">Conjunto</th>
                            <th className="px-4 py-1.5 text-right font-medium">Custo/conversa</th>
                            <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                            <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                            <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                            <th className="px-4 py-1.5 font-medium"></th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Etapa 78: só usado pra decidir onde entra o divisor
                        // "Com anúncio ativo" — os "Sem anúncio ativo" já vêm
                        // primeiro (ver filteredGroups acima).
                        const noActiveAdCount = separateNoActiveAd
                          ? g.adsets.filter((as) => as.has_active_ad === false).length
                          : 0;
                        return g.adsets.map((adset, adsetIdx) => {
                        const noConversion = !adset.conversations || adset.conversations <= 0;
                        const noActiveAd = adset.has_active_ad === false;
                        const diff = diffFor(adset.spend, adset.conversations, adset.cost_per_conversation, g.cpaTarget);
                        const isOpen = expanded.has(adset.id);
                        const wasIncreased = increasedIds.has(adset.id);
                        const isGood = goodTrend(adset.avg_cost_7d, g.cpaTarget);
                        const showDivider =
                          separateNoActiveAd && noActiveAdCount > 0 && noActiveAdCount < g.adsets.length && adsetIdx === noActiveAdCount;
                        const created = fmtAdsetDate(adset.created_time);
                        const nameTd = (
                              <td className="max-w-[260px] px-4 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3 shrink-0 text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                                  <span className="min-w-0 truncate" title={adset.name}>
                                    {adset.name}
                                  </span>
                                  {noActiveAd ? (
                                    <span
                                      title="Esse conjunto está ativo, mas nenhum anúncio dentro dele está ativo"
                                      className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
                                    >
                                      Sem anúncio ativo
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                        );
                        const cpaTd = (
                              <td
                                className={`px-4 py-2 text-right tabular-nums font-medium ${
                                  mode === "above" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                                }`}
                              >
                                {noConversion ? (
                                  <span title="Sem conversa iniciada no período — sinalizado pelo gasto acima da Meta CPA">
                                    —
                                  </span>
                                ) : (
                                  fmtCurrency(adset.cost_per_conversation)
                                )}
                              </td>
                        );
                        const diffTd = (
                              <td
                                className={`px-4 py-2 text-right tabular-nums ${
                                  diff >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {fmtDiffSigned(diff)}
                              </td>
                        );
                        const convTd = (
                              <td className="px-4 py-2 text-right tabular-nums">{adset.conversations ?? "—"}</td>
                        );
                        const spendTd = (
                              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(adset.spend)}</td>
                        );
                        const dateTd = (
                              <td
                                className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                                title={created ? `Conjunto criado em ${created.full}` : "Data de criação não disponível"}
                              >
                                {created?.short ?? "—"}
                              </td>
                        );
                        const actBelowTd = (
                              <td className="whitespace-nowrap px-4 py-2 text-right">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDupTarget({
                                        id: adset.id,
                                        name: adset.name,
                                        accountId: g.accountId,
                                        cpaTarget: g.cpaTarget,
                                        ads: adset.ads,
                                      });
                                    }}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    title="Duplica esse conjunto (nasce pausado) escolhendo quais criativos vão junto"
                                    className="mr-2 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                  >
                                    Duplicar
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void increaseBudget(adset);
                                    }}
                                    disabled={actingId === adset.id || wasIncreased || belowBulk.running}
                                    title="Aumenta o orçamento diário desse conjunto em R$2,50 fixo"
                                    className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400"
                                  >
                                    {actingId === adset.id ? "…" : wasIncreased ? "✓ Aumentado" : "Aumentar +R$2,50"}
                                  </button>
                              </td>
                        );
                        return (
                          <Fragment key={adset.id}>
                            {showDivider ? (
                              <tr>
                                <td colSpan={7} className="border-t border-zinc-200 bg-zinc-50 px-4 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                                  Com anúncio ativo
                                </td>
                              </tr>
                            ) : null}
                            <tr
                              onDoubleClick={() => toggleExpand(adset.id)}
                              title={isGood ? GOOD_TREND_TITLE : "Duplo clique pra ver os criativos desse conjunto"}
                              className={`cursor-pointer select-none border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40 ${
                                isGood ? GOOD_TREND_CLASS : ""
                              }`}
                            >
                              <td
                                className="px-4 py-2"
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedAdsetIds.has(adset.id)}
                                  onChange={() => toggleAdsetSelected(adset.id)}
                                  disabled={mode === "above" ? aboveAdsetBusy : belowBusy || wasIncreased}
                                />
                              </td>
                              {mode === "above" ? (
                                <>
                                  {dateTd}
                                  {nameTd}
                                  {spendTd}
                                  {cpaTd}
                                  {convTd}
                                  {diffTd}
                                </>
                              ) : (
                                <>
                                  {nameTd}
                                  {cpaTd}
                                  {diffTd}
                                  {convTd}
                                  {spendTd}
                                  {actBelowTd}
                                </>
                              )}
                            </tr>
                            {isOpen ? (
                              <tr className="border-t border-zinc-100 dark:border-zinc-800/60">
                                <td colSpan={7} className="bg-zinc-50/60 px-4 py-2 dark:bg-zinc-800/20">
                                  {adset.ads.length === 0 ? (
                                    <p className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                      Nenhum anúncio com gasto nesse conjunto no período selecionado.
                                    </p>
                                  ) : (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                                        <th className="px-3 py-1 font-medium">Criativo</th>
                                        <th className="px-3 py-1 text-right font-medium">Custo/conversa</th>
                                        <th className="px-3 py-1 text-right font-medium">Conversas</th>
                                        <th className="px-3 py-1 text-right font-medium">Gasto</th>
                                        <th className="px-3 py-1 font-medium">Status</th>
                                        <th className="px-3 py-1 font-medium"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {adset.ads.map((ad) => {
                                        const adNoConversion = !ad.conversations || ad.conversations <= 0;
                                        const adIsGood = goodTrend(ad.avg_cost_7d, g.cpaTarget);
                                        return (
                                          <tr
                                            key={ad.id}
                                            title={adIsGood ? GOOD_TREND_TITLE : undefined}
                                            className={`border-t border-zinc-100 dark:border-zinc-800/60 ${adIsGood ? GOOD_TREND_CLASS : ""}`}
                                          >
                                            <td className="max-w-[240px] truncate px-3 py-1.5" title={ad.name}>
                                              {ad.name}
                                            </td>
                                            <td className="px-3 py-1.5 text-right tabular-nums">
                                              {adNoConversion ? "—" : fmtCurrency(ad.cost_per_conversation)}
                                            </td>
                                            <td className="px-3 py-1.5 text-right tabular-nums">{ad.conversations ?? "—"}</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtCurrency(ad.spend)}</td>
                                            <td className="px-3 py-1.5">
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                  ad.status?.toUpperCase() === "ACTIVE"
                                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                                }`}
                                              >
                                                {statusLabel(ad.status)}
                                              </span>
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                              <button
                                                onClick={() => void pauseCreative(ad, adset.id)}
                                                disabled={actingId === ad.id || aboveAdsetBusy}
                                                title="Pausa só esse criativo — não mexe no conjunto"
                                                className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                                              >
                                                {actingId === ad.id ? "…" : "Pausar criativo"}
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      ) : null}

      {/* ─── Tela Criativos (Etapa 40/41 — só na aba "acima da meta") ─── */}
      {mode === "above" && subPanel === "criativos" ? (
        <div>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Criativos</h3>

          {/* Etapa 127: filtro rápido da lista (não faz nova busca na Meta) */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
            <span className="text-xs text-zinc-400">Filtrar:</span>
            {CREATIVE_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setCreativeFilter(f.id)}
                disabled={aboveCreativeBusy}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  creativeFilter === f.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {f.label} ({creativeFilterCounts[f.id]})
              </button>
            ))}
          </div>

          <BulkBar
            label="Pausar todos os criativos listados"
            count={aboveCreativeBulkTargets.length}
            verb="Pausando"
            bulk={aboveCreativeBulk}
            disabled={aboveCreativeBusy}
            onConfirm={() => void aboveCreativeBulk.run(aboveCreativeBulkTargets, (a) => a.name, pauseOneCreativeStandalone)}
          />
          <BulkErrorsBanner bulk={aboveCreativeBulk} verb="criativo(s) não pausado(s)" />

          {/* Etapa 42: pausar só quem foi marcado na caixinha */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={allCreativesSelected}
                onChange={toggleAllCreativesSelected}
                disabled={aboveCreativeBusy}
              />
              Selecionar todos os listados
            </label>
          </div>
          <BulkBar
            label="Pausar selecionados"
            count={aboveCreativeSelectedTargets.length}
            verb="Pausando"
            bulk={aboveCreativeSelectedBulk}
            disabled={aboveCreativeBusy}
            onConfirm={() =>
              void aboveCreativeSelectedBulk
                .run(aboveCreativeSelectedTargets, (a) => a.name, pauseOneCreativeStandalone)
                .then(() => setSelectedCreativeIds(new Set()))
            }
          />
          <BulkErrorsBanner bulk={aboveCreativeSelectedBulk} verb="criativo(s) selecionado(s) não pausado(s)" />

          {creativeError ? (
            <p className="px-4 py-6 text-sm text-red-600">{creativeError}</p>
          ) : !creativeGroups ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : totalCreatives === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              {q
                ? "Nenhum criativo encontrado com esse nome."
                : creativeFilter !== "all" && (creativeGroups ?? []).length > 0
                  ? "Nenhum criativo nesse filtro — escolha \"Todos\" pra ver a lista inteira."
                  : "Nenhum criativo ativo acima do limite nesse período."}
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredCreativeGroups.map((g) => (
                <div key={g.accountId}>
                  <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-800/40">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{g.clientName}</span>
                    <a
                      href={adsManagerUrl(g.accountId, preset)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir no Gerenciador de Anúncios"
                      className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {accountNameById.get(g.accountId) ?? g.accountId}
                    </a>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Meta CPA: {fmtCurrency(g.cpaTarget)}</span>
                    <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      {g.ads.length} criativo(s)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                          <th className="w-8 px-4 py-1.5"></th>
                          <th className="px-4 py-1.5 font-medium">Data</th>
                          <th className="px-4 py-1.5 font-medium">Conjunto</th>
                          <th className="px-4 py-1.5 font-medium">Criativo</th>
                          <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                          <th className="px-4 py-1.5 text-right font-medium">CPA</th>
                          <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                          <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.ads.map((ad) => {
                          const noConversion = !ad.conversations || ad.conversations <= 0;
                          const created = fmtAdsetDate(ad.adset_created_time);
                          const diff = diffFor(ad.spend, ad.conversations, ad.cost_per_conversation, g.cpaTarget);
                          const isGood = goodTrend(ad.avg_cost_7d, g.cpaTarget);
                          return (
                            <tr
                              key={ad.id}
                              title={isGood ? GOOD_TREND_TITLE : undefined}
                              className={`border-t border-zinc-100 dark:border-zinc-800/60 ${isGood ? GOOD_TREND_CLASS : ""}`}
                            >
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedCreativeIds.has(ad.id)}
                                  onChange={() => toggleCreativeSelected(ad.id)}
                                  disabled={aboveCreativeBusy}
                                />
                              </td>
                              <td
                                className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                                title={created ? `Conjunto criado em ${created.full}` : "Data de criação não disponível"}
                              >
                                {created?.short ?? "—"}
                              </td>
                              <td className="max-w-[200px] truncate px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400" title={ad.adset_name ?? undefined}>
                                {ad.adset_name ?? "—"}
                              </td>
                              <td className="max-w-[240px] truncate px-4 py-2" title={ad.name}>
                                {ad.name}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(ad.spend)}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">
                                {noConversion ? (
                                  <span title="Sem conversa iniciada no período — sinalizado pelo gasto acima da Meta CPA">
                                    —
                                  </span>
                                ) : (
                                  fmtCurrency(ad.cost_per_conversation)
                                )}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{ad.conversations ?? "—"}</td>
                              <td
                                className={`px-4 py-2 text-right tabular-nums ${
                                  diff >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {fmtDiffSigned(diff)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {dupTarget ? <DuplicarConjuntoDialog adset={dupTarget} onClose={() => setDupTarget(null)} /> : null}

      {skipped.length > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          {skipped.length} conta(s) sem Meta CPA cadastrada, não avaliada(s) aqui: {skipped.map((s) => s.clientName).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

// Etapa 139: Análise ganhou uma sub-área "Aumento programado" (plano de aumento de investimento aplicado às 6h) ao lado da
// análise de sempre. A análise de sempre fica montada (só escondida) pra não perder lista/ação em andamento ao alternar.
export function AnaliseTab(props: {
  accounts: AdAccount[];
  initialFilters?: Record<string, unknown>;
  onFiltersChange?: (filters: AnaliseFilters) => void;
}) {
  const [area, setArea] = useState<"analise" | "aumento" | "videos" | "exame" | "publico">("analise");
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
        {([
          ["analise", "Análise"],
          ["aumento", "Aumento programado"],
          ["videos", "Vídeos (Geral)"],
          ["exame", "Exame"],
          ["publico", "Melhor público"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setArea(id)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              area === id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={area === "analise" ? "" : "hidden"}>
        <AnaliseTabInner {...props} />
      </div>
      {area === "aumento" ? <AumentoProgramado /> : null}
      {area === "videos" ? <VideosGeral accounts={props.accounts} /> : null}
      {area === "exame" ? <ExameTab /> : null}
      {area === "publico" ? <PublicoTab /> : null}
    </div>
  );
}
