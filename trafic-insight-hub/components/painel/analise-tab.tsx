"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

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
}

export function AnaliseTab({
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
  const [increasedIds, setIncreasedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Etapa 42: caixa de seleção pra pausar só quem foi marcado, em vez de
  // sempre todos os listados — só existe nas duas telas de pausar (Conjuntos
  // e Criativos da aba "acima da meta"); "Pausar todos os listados" continua
  // existindo do lado, sem checkbox nenhum marcado.
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set());
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<Set<string>>(new Set());

  // Cinco ações em massa independentes: conjuntos "abaixo da meta" (aumentar
  // orçamento); conjuntos "acima da meta" — todos listados e só selecionados
  // (pausar); criativos "acima da meta" — todos listados e só selecionados
  // (pausar).
  const belowBulk = useBulkRunner<AdSetRow>();
  const aboveAdsetBulk = useBulkRunner<AdSetRow>();
  const aboveAdsetSelectedBulk = useBulkRunner<AdSetRow>();
  const aboveCreativeBulk = useBulkRunner<CreativeRow>();
  const aboveCreativeSelectedBulk = useBulkRunner<CreativeRow>();

  useEffect(() => {
    onFiltersChange?.({ mode, subPanel, preset, search });
  }, [mode, subPanel, preset, search, onFiltersChange]);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a.name])), [accounts]);

  const loadAdsets = useCallback(async () => {
    if (accounts.length === 0) {
      setGroups([]);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/analysis/adsets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIds: accounts.map((a) => a.account_id),
        datePreset: preset,
        mode,
      }),
    });
    const d = await res.json();
    setLoading(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setGroups(d.groups ?? []);
    setSkipped(d.skipped ?? []);
    setIncreasedIds(new Set());
    setSelectedAdsetIds(new Set());
  }, [accounts, preset, mode]);

  // Criativos só existem na aba "acima da meta" — não busca nada na
  // "abaixo da meta", pra não gastar chamada à toa com o que não aparece.
  const loadCreatives = useCallback(async () => {
    if (mode !== "above" || accounts.length === 0) {
      setCreativeGroups(mode !== "above" ? null : []);
      return;
    }
    setCreativeLoading(true);
    setCreativeError(null);
    const res = await fetch("/api/analysis/creatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIds: accounts.map((a) => a.account_id),
        datePreset: preset,
      }),
    });
    const d = await res.json();
    setCreativeLoading(false);
    if (d.error) {
      setCreativeError(d.error);
      return;
    }
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
    if (mode === "below" || subPanel === "conjuntos") void loadAdsets();
    if (mode === "above" && subPanel === "criativos") void loadCreatives();
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
  const disarmAboveAdset = aboveAdsetBulk.disarm;
  const disarmAboveAdsetSelected = aboveAdsetSelectedBulk.disarm;
  const disarmAboveCreative = aboveCreativeBulk.disarm;
  const disarmAboveCreativeSelected = aboveCreativeSelectedBulk.disarm;

  useEffect(() => {
    disarmBelow();
    disarmAboveAdset();
    disarmAboveAdsetSelected();
    disarmAboveCreative();
    disarmAboveCreativeSelected();
  }, [
    mode,
    subPanel,
    preset,
    disarmBelow,
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

  async function pauseAdSet(adset: AdSetRow) {
    setActingId(adset.id);
    const result = await pauseOneAdSet(adset);
    setActingId(null);
    if (!result.ok) alert(result.error);
  }

  // Novo (Etapa 40): pausa um criativo do sub-painel Criativos — mesma
  // chamada simples, mas opera na lista plana (creativeGroups), não na
  // nested de dentro de um conjunto.
  async function pauseOneCreativeStandalone(ad: CreativeRow): Promise<{ ok: true } | { ok: false; error: string }> {
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

  async function pauseCreativeStandalone(ad: CreativeRow) {
    setActingId(ad.id);
    const result = await pauseOneCreativeStandalone(ad);
    setActingId(null);
    if (!result.ok) alert(result.error);
  }

  // Só na aba "abaixo da meta": aumenta o orçamento diário do conjunto em
  // R$2,50 fixo. Fica marcado como "Aumentado" (e o botão trava) até a
  // próxima atualização, pra não dar dois cliques sem querer.
  async function increaseOneBudget(adset: AdSetRow): Promise<{ ok: true } | { ok: false; error: string }> {
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
  const filteredGroups = (groups ?? [])
    .map((g) => ({
      ...g,
      adsets: q
        ? g.adsets.filter(
            (as) => as.name.toLowerCase().includes(q) || (as.campaign_name ?? "").toLowerCase().includes(q),
          )
        : g.adsets,
    }))
    .filter((g) => g.adsets.length > 0);

  const filteredCreativeGroups = (creativeGroups ?? [])
    .map((g) => ({
      ...g,
      ads: q
        ? g.ads.filter((a) => a.name.toLowerCase().includes(q) || (a.campaign_name ?? "").toLowerCase().includes(q))
        : g.ads,
    }))
    .filter((g) => g.ads.length > 0);

  const totalAdsets = filteredGroups.reduce((s, g) => s + g.adsets.length, 0);
  const totalCreatives = filteredCreativeGroups.reduce((s, g) => s + g.ads.length, 0);

  // Na aba "abaixo da meta" a ação em massa pula quem já foi aumentado
  // individualmente (ou por um lote anterior) nessa mesma tela.
  const belowBulkTargets = filteredGroups.flatMap((g) => g.adsets.filter((as) => !increasedIds.has(as.id)));
  const aboveAdsetBulkTargets = filteredGroups.flatMap((g) => g.adsets);
  const aboveCreativeBulkTargets = filteredCreativeGroups.flatMap((g) => g.ads);

  // Etapa 42: dentro dos mesmos listados acima, só quem tem a caixinha
  // marcada — usado pelo botão "Pausar selecionados", ao lado do "Pausar
  // todos os listados" (que continua igual, ignorando a seleção).
  const aboveAdsetSelectedTargets = aboveAdsetBulkTargets.filter((a) => selectedAdsetIds.has(a.id));
  const aboveCreativeSelectedTargets = aboveCreativeBulkTargets.filter((a) => selectedCreativeIds.has(a.id));
  const allAdsetsSelected = aboveAdsetBulkTargets.length > 0 && aboveAdsetBulkTargets.every((a) => selectedAdsetIds.has(a.id));
  const allCreativesSelected =
    aboveCreativeBulkTargets.length > 0 && aboveCreativeBulkTargets.every((a) => selectedCreativeIds.has(a.id));

  function toggleAllAdsetsSelected() {
    setSelectedAdsetIds(allAdsetsSelected ? new Set() : new Set(aboveAdsetBulkTargets.map((a) => a.id)));
  }
  function toggleAllCreativesSelected() {
    setSelectedCreativeIds(allCreativesSelected ? new Set() : new Set(aboveCreativeBulkTargets.map((a) => a.id)));
  }

  // "Ocupado" por lista — trava o botão "todos" enquanto "selecionados"
  // roda (e vice-versa), pra não disparar as duas ações em massa da mesma
  // lista ao mesmo tempo.
  const aboveAdsetBusy = aboveAdsetBulk.running || aboveAdsetSelectedBulk.running;
  const aboveCreativeBusy = aboveCreativeBulk.running || aboveCreativeSelectedBulk.running;

  const controlsDisabled =
    loading ||
    creativeLoading ||
    belowBulk.running ||
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
                : "Custo por conversa no TRIPLO ou mais da Meta CPA, ou sem conversa com o próprio gasto já no triplo ou " +
                  "mais — ou conjunto ativo sem nenhum anúncio ativo dentro dele (badge \"Sem anúncio ativo\"), " +
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
              if (mode === "below" || subPanel === "conjuntos") void loadAdsets();
              if (mode === "above" && subPanel === "criativos") void loadCreatives();
            }}
            disabled={controlsDisabled}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading || creativeLoading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

      {/* ─── Tela Conjuntos (as duas abas usam esse mesmo bloco; Etapa 41: */}
      {/* virou tela exclusiva, alternada com Criativos, em vez de empilhada) ─── */}
      {mode === "below" || subPanel === "conjuntos" ? (
      <div>
        <BulkBar
          label={mode === "above" ? "Pausar todos os conjuntos listados" : "Aumentar todos os orçamentos listados"}
          count={mode === "above" ? aboveAdsetBulkTargets.length : belowBulkTargets.length}
          verb={mode === "above" ? "Pausando" : "Aumentando"}
          bulk={mode === "above" ? aboveAdsetBulk : belowBulk}
          disabled={mode === "above" ? aboveAdsetBusy : loading}
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

        {/* Etapa 42: pausar só quem foi marcado na caixinha — só existe no */}
        {/* modo "acima da meta" (pausar); "abaixo da meta" não tem seleção. */}
        {mode === "above" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allAdsetsSelected}
                  onChange={toggleAllAdsetsSelected}
                  disabled={aboveAdsetBusy}
                />
                Selecionar todos os listados
              </label>
            </div>
            <BulkBar
              label="Pausar selecionados"
              count={aboveAdsetSelectedTargets.length}
              verb="Pausando"
              bulk={aboveAdsetSelectedBulk}
              disabled={aboveAdsetBusy}
              onConfirm={() =>
                void aboveAdsetSelectedBulk
                  .run(aboveAdsetSelectedTargets, (a) => a.name, pauseOneAdSet)
                  .then(() => setSelectedAdsetIds(new Set()))
              }
            />
            <BulkErrorsBanner bulk={aboveAdsetSelectedBulk} verb="conjunto(s) selecionado(s) não pausado(s)" />
          </>
        ) : null}

        {error ? (
          <p className="px-4 py-6 text-sm text-red-600">{error}</p>
        ) : !groups ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
        ) : totalAdsets === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">
            {q
              ? "Nenhum conjunto encontrado com esse nome."
              : mode === "above"
                ? "Nenhum conjunto ativo no triplo (ou mais) da meta, ou sem anúncio ativo, nesse período."
                : "Nenhum conjunto ativo abaixo da meta nesse período."}
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredGroups.map((g) => (
              <div key={g.accountId}>
                <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-800/40">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{g.clientName}</span>
                  <a
                    href={adsManagerUrl(g.accountId)}
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
                        {mode === "above" ? <th className="w-8 px-4 py-1.5"></th> : null}
                        <th className="px-4 py-1.5 font-medium">Conjunto</th>
                        <th className="px-4 py-1.5 text-right font-medium">Custo/conversa</th>
                        <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                        <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                        <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                        <th className="px-4 py-1.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.adsets.map((adset) => {
                        const noConversion = !adset.conversations || adset.conversations <= 0;
                        const noActiveAd = adset.has_active_ad === false;
                        const diff = diffFor(adset.spend, adset.conversations, adset.cost_per_conversation, g.cpaTarget);
                        const isOpen = expanded.has(adset.id);
                        const wasIncreased = increasedIds.has(adset.id);
                        const isGood = goodTrend(adset.avg_cost_7d, g.cpaTarget);
                        return (
                          <Fragment key={adset.id}>
                            <tr
                              onDoubleClick={() => toggleExpand(adset.id)}
                              title={isGood ? GOOD_TREND_TITLE : "Duplo clique pra ver os criativos desse conjunto"}
                              className={`cursor-pointer select-none border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40 ${
                                isGood ? GOOD_TREND_CLASS : ""
                              }`}
                            >
                              {mode === "above" ? (
                                <td
                                  className="px-4 py-2"
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedAdsetIds.has(adset.id)}
                                    onChange={() => toggleAdsetSelected(adset.id)}
                                    disabled={aboveAdsetBusy}
                                  />
                                </td>
                              ) : null}
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
                              <td
                                className={`px-4 py-2 text-right tabular-nums ${
                                  diff >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {fmtDiffSigned(diff)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{adset.conversations ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(adset.spend)}</td>
                              <td className="px-4 py-2 text-right">
                                {mode === "above" ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void pauseAdSet(adset);
                                    }}
                                    disabled={actingId === adset.id || aboveAdsetBusy}
                                    title="Pausa só o conjunto inteiro — não mexe em nenhum criativo"
                                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                                  >
                                    {actingId === adset.id ? "…" : "Pausar conjunto"}
                                  </button>
                                ) : (
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
                                )}
                              </td>
                            </tr>
                            {isOpen ? (
                              <tr className="border-t border-zinc-100 dark:border-zinc-800/60">
                                <td colSpan={mode === "above" ? 7 : 6} className="bg-zinc-50/60 px-4 py-2 dark:bg-zinc-800/20">
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

      {/* ─── Tela Criativos (Etapa 40/41 — só na aba "acima da meta") ─── */}
      {mode === "above" && subPanel === "criativos" ? (
        <div>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Criativos</h3>

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
              {q ? "Nenhum criativo encontrado com esse nome." : "Nenhum criativo ativo acima do limite nesse período."}
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredCreativeGroups.map((g) => (
                <div key={g.accountId}>
                  <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-800/40">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{g.clientName}</span>
                    <a
                      href={adsManagerUrl(g.accountId)}
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
                          <th className="px-4 py-1.5 font-medium">Criativo</th>
                          <th className="px-4 py-1.5 font-medium">Conjunto</th>
                          <th className="px-4 py-1.5 text-right font-medium">Custo/conversa</th>
                          <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                          <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                          <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                          <th className="px-4 py-1.5 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.ads.map((ad) => {
                          const noConversion = !ad.conversations || ad.conversations <= 0;
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
                              <td className="max-w-[220px] truncate px-4 py-2" title={ad.name}>
                                {ad.name}
                              </td>
                              <td className="max-w-[180px] truncate px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400" title={ad.adset_name ?? undefined}>
                                {ad.adset_name ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">
                                {noConversion ? (
                                  <span title="Sem conversa iniciada no período — sinalizado pelo gasto acima da Meta CPA">
                                    —
                                  </span>
                                ) : (
                                  fmtCurrency(ad.cost_per_conversation)
                                )}
                              </td>
                              <td
                                className={`px-4 py-2 text-right tabular-nums ${
                                  diff >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {fmtDiffSigned(diff)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{ad.conversations ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(ad.spend)}</td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => void pauseCreativeStandalone(ad)}
                                  disabled={actingId === ad.id || aboveCreativeBusy}
                                  title="Pausa só esse criativo"
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          {skipped.length} conta(s) sem Meta CPA cadastrada, não avaliada(s) aqui: {skipped.map((s) => s.clientName).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
