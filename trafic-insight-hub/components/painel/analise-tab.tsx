"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// "Últimos 3 dias + hoje" (padrão recomendado — pega problema recente
// rápido) já vem primeiro em DATE_PRESETS, junto com os demais períodos
// usados no resto do Painel.
const ANALYSIS_PRESETS = DATE_PRESETS;

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

const MODE_COPY: Record<AnalysisMode, { title: string; description: string; empty: string }> = {
  above: {
    title: "Custo por conversa iniciada, por conjunto — acima da meta",
    description:
      "Só conjunto ativo, com custo por conversa iniciada R$ 4 ou mais acima da Meta CPA — ou, sem nenhuma " +
      "conversa iniciada, com o próprio gasto R$ 4 ou mais acima da Meta CPA. Duplo clique no conjunto mostra os " +
      "criativos dele. Nada é pausado ou alterado sozinho, os botões são manuais.",
    empty: "Nenhum conjunto ativo acima do limite nesse período.",
  },
  below: {
    title: "Custo por conversa iniciada, por conjunto — abaixo da meta",
    description:
      "Só conjunto ativo, com pelo menos uma conversa iniciada no período e custo por conversa abaixo da Meta " +
      "CPA — candidato a receber mais investimento. Duplo clique no conjunto mostra os criativos dele. Nada é " +
      "alterado sozinho, os botões são manuais.",
    empty: "Nenhum conjunto ativo abaixo da meta nesse período.",
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
  }, [accounts, preset, mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca a análise ao trocar contas/período/aba exibidos
    void load();
  }, [load]);

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
  async function pauseAdSet(adset: AdSetRow) {
    setActingId(adset.id);
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: adset.id, type: "adset" }], status: "PAUSED" }),
    });
    const d = await res.json();
    setActingId(null);
    const result = d.results?.[0];
    if (!result?.ok) {
      alert(result?.error ?? "Não foi possível pausar o conjunto.");
      return;
    }
    setGroups((prev) =>
      prev
        ? prev.map((g) => ({ ...g, adsets: g.adsets.filter((as) => as.id !== adset.id) })).filter((g) => g.adsets.length > 0)
        : prev,
    );
  }

  // Só na aba "abaixo da meta": aumenta o orçamento diário do conjunto em
  // R$2,50 fixo. Fica marcado como "Aumentado" (e o botão trava) até a
  // próxima atualização, pra não dar dois cliques sem querer.
  async function increaseBudget(adset: AdSetRow) {
    setActingId(adset.id);
    const res = await fetch("/api/analysis/increase-budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adsetId: adset.id }),
    });
    const d = await res.json();
    setActingId(null);
    if (!d.ok) {
      alert(d.error ?? "Não foi possível aumentar o orçamento desse conjunto.");
      return;
    }
    setIncreasedIds((prev) => new Set(prev).add(adset.id));
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
  const copy = MODE_COPY[mode];

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
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "above"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              CPA acima da meta
            </button>
            <button
              onClick={() => setMode("below")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
            placeholder="Buscar conjunto/campanha…"
            className="h-8 w-52 rounded-md border border-zinc-300 bg-transparent px-2.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
          >
            {ANALYSIS_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

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
                                  disabled={actingId === adset.id}
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
                                  disabled={actingId === adset.id || wasIncreased}
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
                                              disabled={actingId === ad.id}
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
