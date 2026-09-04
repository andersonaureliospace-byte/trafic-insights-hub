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

interface AdRow {
  id: string;
  name: string;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
}

interface AdSetRow {
  id: string;
  name: string;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  ads: AdRow[];
}

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  adsets: AdSetRow[];
}

interface Skipped {
  accountId: string;
  clientName: string;
}

interface BulkError {
  name: string;
  error: string;
}

const MODE_COPY: Record<AnalysisMode, { title: string; description: string; empty: string; bulkLabel: string }> = {
  above: {
    title: "Custo por conversa iniciada, por conjunto — acima da meta",
    description:
      "Só conjunto ativo, com custo por conversa iniciada R$ 4 ou mais acima da Meta CPA — ou, sem nenhuma " +
      "conversa iniciada, com o próprio gasto R$ 4 ou mais acima da Meta CPA. Duplo clique no conjunto mostra os " +
      "criativos dele. Nada é pausado ou alterado sozinho, os botões (individual ou em massa) são manuais.",
    empty: "Nenhum conjunto ativo acima do limite nesse período.",
    bulkLabel: "Pausar todos os conjuntos listados",
  },
  below: {
    title: "Custo por conversa iniciada, por conjunto — abaixo da meta",
    description:
      "Só conjunto ativo, com pelo menos uma conversa iniciada no período e custo por conversa abaixo da Meta " +
      "CPA — candidato a receber mais investimento. Duplo clique no conjunto mostra os criativos dele. Nada é " +
      "alterado sozinho, os botões (individual ou em massa) são manuais.",
    empty: "Nenhum conjunto ativo abaixo da meta nesse período.",
    bulkLabel: "Aumentar todos os orçamentos listados",
  },
};

function statusLabel(status: string | null): string {
  const s = status?.toUpperCase();
  if (s === "ACTIVE") return "Ativo";
  if (s === "PAUSED") return "Pausado";
  return status || "—";
}

// Mesmo cálculo de "Diferença" usado nas duas linhas (conjunto e criativo):
// sem conversa, o sinal vira o próprio gasto acima da Meta CPA; com
// conversa, é custo por conversa menos a Meta CPA. Negativo = abaixo da meta.
function diffFor(spend: number, conversations: number | null, costPerConversation: number | null, cpaTarget: number) {
  const noConversion = !conversations || conversations <= 0;
  return noConversion ? spend - cpaTarget : (costPerConversation ?? 0) - cpaTarget;
}

function fmtDiffSigned(diff: number): string {
  return `${diff >= 0 ? "+" : "-"}${fmtCurrency(Math.abs(diff))}`;
}

export function AnaliseTab({ accounts }: { accounts: AdAccount[] }) {
  const [mode, setMode] = useState<AnalysisMode>("above");
  const [preset, setPreset] = useState("last_3d_plus_today");
  const [search, setSearch] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [increasedIds, setIncreasedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Ação em massa (Etapa 33): 1º clique "arma" o botão (pede confirmação
  // sem usar popup do navegador — pedido explícito anterior), 2º clique
  // dentro de alguns segundos de fato executa. Roda uma chamada de cada vez
  // (nunca em paralelo), com pausa entre elas — mais seguro pro limite de
  // chamadas da Meta, mesmo que demore mais.
  const [bulkArmed, setBulkArmed] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkErrors, setBulkErrors] = useState<BulkError[]>([]);
  const bulkArmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a.name])), [accounts]);

  const load = useCallback(async () => {
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
    setBulkErrors([]);
  }, [accounts, preset, mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca a análise ao trocar contas/período/aba exibidos
    void load();
  }, [load]);

  // Desarma o botão em massa sozinho ao trocar de aba/período — evita
  // confirmar sem querer uma ação pensada pra outra lista.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- desarma a confirmação em massa ao trocar de aba/período, de propósito
    setBulkArmed(false);
    if (bulkArmTimeout.current) clearTimeout(bulkArmTimeout.current);
  }, [mode, preset]);

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
  // no conjunto. Sem popup de confirmação (pedido explícito também).
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

  // Isolado de propósito (pedido explícito): só pausa o conjunto inteiro,
  // mesma chamada simples de /api/meta/status já usada em Visão Geral — sem
  // renomear nem duplicar nada. Some da lista ao pausar, já que deixa de ser
  // um conjunto ativo pra sinalizar aqui. Sem popup de confirmação.
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

  function armBulk() {
    setBulkArmed(true);
    if (bulkArmTimeout.current) clearTimeout(bulkArmTimeout.current);
    bulkArmTimeout.current = setTimeout(() => setBulkArmed(false), BULK_ARM_MS);
  }

  function cancelBulkArm() {
    setBulkArmed(false);
    if (bulkArmTimeout.current) clearTimeout(bulkArmTimeout.current);
  }

  // Roda a ação (pausar ou aumentar) em cada conjunto atualmente listado,
  // um de cada vez, com pausa entre chamadas — de propósito lento, pra não
  // estourar o limite de chamadas da Meta numa conta com muitos conjuntos.
  // Erros individuais não interrompem o restante do lote; ficam guardados
  // pra mostrar um resumo no final.
  async function runBulk(targets: AdSetRow[], action: (adset: AdSetRow) => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (bulkArmTimeout.current) clearTimeout(bulkArmTimeout.current);
    setBulkArmed(false);
    if (targets.length === 0) return;
    setBulkRunning(true);
    setBulkErrors([]);
    setBulkProgress({ done: 0, total: targets.length });
    const errors: BulkError[] = [];
    for (let i = 0; i < targets.length; i++) {
      const adset = targets[i];
      try {
        const result = await action(adset);
        if (!result.ok) errors.push({ name: adset.name, error: result.error });
      } catch (e) {
        errors.push({ name: adset.name, error: (e as Error).message });
      }
      setBulkProgress({ done: i + 1, total: targets.length });
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
    }
    setBulkRunning(false);
    setBulkProgress(null);
    setBulkErrors(errors);
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

  const totalAdsets = filteredGroups.reduce((s, g) => s + g.adsets.length, 0);
  // Na aba "abaixo da meta" a ação em massa pula quem já foi aumentado
  // individualmente (ou por um lote anterior) nessa mesma tela.
  const bulkTargets =
    mode === "below"
      ? filteredGroups.flatMap((g) => g.adsets.filter((as) => !increasedIds.has(as.id)))
      : filteredGroups.flatMap((g) => g.adsets);
  const copy = MODE_COPY[mode];

  function handleBulkClick() {
    if (bulkArmed) {
      void runBulk(bulkTargets, mode === "above" ? pauseOneAdSet : increaseOneBudget);
    } else {
      armBulk();
    }
  }

  const controlsDisabled = loading || bulkRunning;

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
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {copy.title} {loading ? "· atualizando…" : ""}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={controlsDisabled}
            placeholder="Buscar conjunto/campanha…"
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
            onClick={() => void load()}
            disabled={controlsDisabled}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

      {totalAdsets > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/60 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-800/20">
          {bulkRunning && bulkProgress ? (
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              {mode === "above" ? "Pausando" : "Aumentando"} {bulkProgress.done} de {bulkProgress.total}
              {bulkProgress.done < bulkProgress.total ? "… (uma chamada por vez, de propósito)" : "…"}
            </span>
          ) : (
            <>
              <button
                onClick={handleBulkClick}
                disabled={bulkTargets.length === 0 || loading}
                title={
                  mode === "above"
                    ? "Pausa, um conjunto de cada vez com pausa entre chamadas, todos os conjuntos listados nessa aba/busca"
                    : "Aumenta em R$2,50, um conjunto de cada vez com pausa entre chamadas, todos os conjuntos listados nessa aba/busca"
                }
                className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  bulkArmed
                    ? mode === "above"
                      ? "border-red-400 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                      : "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {bulkArmed ? `Confirma ${copy.bulkLabel.toLowerCase()} (${bulkTargets.length})?` : `${copy.bulkLabel} (${bulkTargets.length})`}
              </button>
              {bulkArmed ? (
                <button
                  onClick={cancelBulkArm}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                >
                  Cancelar
                </button>
              ) : null}
              {bulkArmed ? (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Clique de novo pra confirmar — some sozinho em {BULK_ARM_MS / 1000}s.
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {bulkErrors.length > 0 ? (
        <div className="flex flex-col gap-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {bulkErrors.length} conjunto(s) não {mode === "above" ? "pausados" : "aumentados"} nessa leva:
            </span>
            <button onClick={() => setBulkErrors([])} className="text-amber-700 hover:underline dark:text-amber-300">
              dispensar
            </button>
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {bulkErrors.map((be, i) => (
              <li key={i}>
                <span className="font-medium">{be.name}:</span> {be.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : !groups ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : totalAdsets === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          {q ? "Nenhum conjunto encontrado com esse nome." : copy.empty}
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
                      const diff = diffFor(adset.spend, adset.conversations, adset.cost_per_conversation, g.cpaTarget);
                      const isOpen = expanded.has(adset.id);
                      const wasIncreased = increasedIds.has(adset.id);
                      return (
                        <Fragment key={adset.id}>
                          <tr
                            onDoubleClick={() => toggleExpand(adset.id)}
                            className="cursor-pointer select-none border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                            title="Duplo clique pra ver os criativos desse conjunto"
                          >
                            <td className="max-w-[260px] truncate px-4 py-2" title={adset.name}>
                              <span className="mr-1 inline-block w-3 text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                              {adset.name}
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
                                  disabled={actingId === adset.id || bulkRunning}
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
                                  disabled={actingId === adset.id || wasIncreased || bulkRunning}
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
                              <td colSpan={6} className="bg-zinc-50/60 px-4 py-2 dark:bg-zinc-800/20">
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
                                      return (
                                        <tr key={ad.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
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
                                              disabled={actingId === ad.id || bulkRunning}
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

      {skipped.length > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          {skipped.length} conta(s) sem Meta CPA cadastrada, não avaliada(s) aqui: {skipped.map((s) => s.clientName).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
