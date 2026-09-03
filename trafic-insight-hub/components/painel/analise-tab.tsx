"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { DATE_PRESETS, fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// "Últimos 3 dias + hoje" (padrão recomendado — pega problema recente
// rápido) já vem primeiro em DATE_PRESETS, junto com os demais períodos
// usados no resto do Painel.
const ANALYSIS_PRESETS = DATE_PRESETS;

interface CreativeRow {
  id: string;
  name: string;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
}

interface Group {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  ads: CreativeRow[];
}

interface Skipped {
  accountId: string;
  clientName: string;
}

function statusLabel(status: string | null): string {
  const s = status?.toUpperCase();
  if (s === "ACTIVE") return "Ativo";
  if (s === "PAUSED") return "Pausado";
  return status || "—";
}

export function AnaliseTab({ accounts }: { accounts: AdAccount[] }) {
  const [preset, setPreset] = useState("last_3d_plus_today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a.name])), [accounts]);

  const load = useCallback(async () => {
    if (accounts.length === 0) {
      setGroups([]);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/analysis/creatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIds: accounts.map((a) => a.account_id),
        datePreset: preset,
        statuses: statusFilter === "all" ? ["ACTIVE", "PAUSED"] : ["ACTIVE"],
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
  }, [accounts, preset, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca a análise ao trocar contas exibidas/período/filtro de status
    void load();
  }, [load]);

  async function toggleStatus(ad: CreativeRow) {
    const next = ad.status?.toUpperCase() === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setTogglingId(ad.id);
    const res = await fetch("/api/meta/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: ad.id, type: "ad" }], status: next }),
    });
    const d = await res.json();
    setTogglingId(null);
    const result = d.results?.[0];
    if (!result?.ok) {
      alert(result?.error ?? "Não foi possível atualizar o status.");
      return;
    }
    setGroups((prev) =>
      prev
        ? prev.map((g) => ({ ...g, ads: g.ads.map((a) => (a.id === ad.id ? { ...a, status: next } : a)) }))
        : prev,
    );
  }

  // Busca por nome — de propósito global: filtra o criativo em qualquer
  // conta/cliente ao mesmo tempo, não só dentro de um grupo por vez.
  const q = search.trim().toLowerCase();
  const filteredGroups = (groups ?? [])
    .map((g) => ({
      ...g,
      ads: q
        ? g.ads.filter(
            (ad) =>
              ad.name.toLowerCase().includes(q) ||
              (ad.adset_name ?? "").toLowerCase().includes(q) ||
              (ad.campaign_name ?? "").toLowerCase().includes(q),
          )
        : g.ads,
    }))
    .filter((g) => g.ads.length > 0);

  const totalAds = filteredGroups.reduce((s, g) => s + g.ads.length, 0);

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Custo por conversa iniciada {loading ? "· atualizando…" : ""}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Com custo por conversa iniciada R$ 4 ou mais acima da Meta CPA — ou, sem nenhuma conversa iniciada, com o
            próprio gasto R$ 4 ou mais acima da Meta CPA. Nada é pausado sozinho, o botão é manual.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar criativo por nome…"
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

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Status</span>
        <button
          type="button"
          onClick={() => setStatusFilter("active")}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            statusFilter === "active"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          Ativos
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          title="Ativos e pausados"
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            statusFilter === "all"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          Todos
        </button>
      </div>

      {error ? (
        <p className="px-4 py-6 text-sm text-red-600">{error}</p>
      ) : !groups ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : totalAds === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          {q ? "Nenhum criativo encontrado com esse nome." : "Nenhum criativo acima do limite nesse período."}
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
                  {g.ads.length} criativo(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                      <th className="px-4 py-1.5 font-medium">Anúncio</th>
                      <th className="px-4 py-1.5 font-medium">Conjunto</th>
                      <th className="px-4 py-1.5 text-right font-medium">Custo/conversa</th>
                      <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
                      <th className="px-4 py-1.5 text-right font-medium">Conversas</th>
                      <th className="px-4 py-1.5 text-right font-medium">Gasto</th>
                      <th className="px-4 py-1.5 font-medium">Status</th>
                      <th className="px-4 py-1.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.ads.map((ad) => {
                      const active = ad.status?.toUpperCase() === "ACTIVE";
                      const noConversion = !ad.conversations || ad.conversations <= 0;
                      // Sem conversa iniciada, não existe "custo por conversa" pra comparar — o sinal
                      // vira o próprio gasto (ex.: CPA ideal R$6, gastou R$10, zero conversa).
                      const diff = noConversion ? ad.spend - g.cpaTarget : (ad.cost_per_conversation ?? 0) - g.cpaTarget;
                      return (
                        <tr key={ad.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                          <td className="max-w-[240px] truncate px-4 py-2" title={ad.name}>
                            {ad.name}
                          </td>
                          <td
                            className="max-w-[180px] truncate px-4 py-2 text-zinc-500 dark:text-zinc-400"
                            title={ad.adset_name ?? undefined}
                          >
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
                          <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                            +{fmtCurrency(diff)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{ad.conversations ?? "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(ad.spend)}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                active
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {statusLabel(ad.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => void toggleStatus(ad)}
                              disabled={togglingId === ad.id}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                            >
                              {togglingId === ad.id ? "…" : active ? "Pausar" : "Ativar"}
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

      {skipped.length > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          {skipped.length} conta(s) sem Meta CPA cadastrada, não avaliada(s) aqui: {skipped.map((s) => s.clientName).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
