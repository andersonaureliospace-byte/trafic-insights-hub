"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 217: Análise → "Conjuntos da conta". Escolhe UMA conta e só então busca na Meta (economiza requisição).
// Números dos últimos 30 dias. Filtros: todos ativos · com impressão nos 30 dias (inclusive pausados) · CPA acima · CPA abaixo.

interface Row {
  id: string;
  name: string;
  campaign_name: string | null;
  status: string;
  daily_budget: number | null;
  cbo: boolean;
  created_time: string | null;
  spend: number;
  impressions: number;
  conversations: number;
  cpa: number | null;
}
interface Data {
  accountId: string;
  clientName: string;
  cpaTarget: number | null;
  fetchedAt: string;
  adsets: Row[];
}

type FilterId = "ativos" | "impressao" | "acima" | "abaixo";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "ativos", label: "Todos ativos" },
  { id: "impressao", label: "Com impressão nos 30 dias (inclui pausados)" },
  { id: "acima", label: "CPA acima da meta" },
  { id: "abaixo", label: "CPA abaixo da meta" },
];

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Ativo", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  PAUSED: { label: "Pausado", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  CAMPAIGN_PAUSED: { label: "Campanha pausada", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  IN_PROCESS: { label: "Processando", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  WITH_ISSUES: { label: "Com problema", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

// Acima: com conversa e CPA acima da meta, ou sem conversa e gasto acima da meta. Abaixo: com conversa e CPA na meta ou abaixo.
function cpaSide(r: Row, target: number | null): "acima" | "abaixo" | null {
  if (target == null || r.impressions <= 0) return null;
  if (r.conversations > 0 && r.cpa != null) return r.cpa > target ? "acima" : "abaixo";
  return r.spend > target ? "acima" : null;
}

export function ConjuntosConta({ accounts }: { accounts: AdAccount[] }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState("");
  const [filter, setFilter] = useState<FilterId>("ativos");
  const [cache, setCache] = useState<Record<string, Data>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account-bindings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { bindings?: Array<{ ad_account_id: string; client_name: string | null }> }) =>
        setNames(Object.fromEntries((d.bindings ?? []).map((b) => [b.ad_account_id, (b.client_name ?? "").trim()]))),
      )
      .catch(() => {});
  }, []);

  const options = useMemo(
    () =>
      accounts
        .map((a) => ({ id: a.account_id, name: names[a.account_id] || a.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [accounts, names],
  );

  async function load(id: string, force = false) {
    if (!id) return;
    if (!force && cache[id]) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/adsets-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else setCache((c) => ({ ...c, [id]: d as Data }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const data = accountId ? cache[accountId] : undefined;
  const target = data?.cpaTarget ?? null;
  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { ativos: 0, impressao: 0, acima: 0, abaixo: 0 };
    for (const r of data?.adsets ?? []) {
      if (r.status === "ACTIVE") c.ativos++;
      if (r.impressions > 0) c.impressao++;
      const side = cpaSide(r, target);
      if (side) c[side]++;
    }
    return c;
  }, [data, target]);
  const rows = useMemo(() => {
    const list = (data?.adsets ?? []).filter((r) =>
      filter === "ativos" ? r.status === "ACTIVE" : filter === "impressao" ? r.impressions > 0 : cpaSide(r, target) === filter,
    );
    const key = (r: Row) => r.cpa ?? (r.spend > 0 ? r.spend : Number.POSITIVE_INFINITY);
    return list.sort((a, b) => (filter === "abaixo" ? key(a) - key(b) : filter === "acima" ? key(b) - key(a) : b.spend - a.spend));
  }, [data, filter, target]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            void load(e.target.value);
          }}
          className="h-8 max-w-[280px] rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">Escolha a conta de anúncios…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {accountId ? (
          <button
            onClick={() => void load(accountId, true)}
            disabled={loading}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Buscando…" : "↻ Atualizar"}
          </button>
        ) : null}
        {data ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Últimos 30 dias · CPA ideal {target != null ? fmtCurrency(target) : "não cadastrado"} · buscado às{" "}
            {new Date(data.fetchedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>

      {accountId ? (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800/60">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              disabled={(f.id === "acima" || f.id === "abaixo") && target == null}
              className={`h-7 rounded-full px-2.5 text-xs font-medium disabled:opacity-40 ${
                filter === f.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {f.label} {data ? `(${counts[f.id]})` : ""}
            </button>
          ))}
        </div>
      ) : null}

      {!accountId ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">
          Escolha uma conta pra ver os conjuntos. A busca na Meta só acontece quando você escolhe — uma conta por vez.
        </p>
      ) : null}
      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {accountId && loading && !data ? <p className="px-4 py-6 text-sm text-zinc-500">Buscando na Meta…</p> : null}
      {data && rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">Nenhum conjunto nesse filtro.</p> : null}

      {data && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-1.5 font-medium">Conjunto</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 text-right font-medium">Orçamento/dia</th>
                <th className="px-3 py-1.5 text-right font-medium">Gasto 30d</th>
                <th className="px-3 py-1.5 text-right font-medium">Impressões</th>
                <th className="px-3 py-1.5 text-right font-medium">Conversas</th>
                <th className="px-3 py-1.5 text-right font-medium">CPA 30d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const side = cpaSide(r, target);
                const st = STATUS[r.status] ?? { label: r.status.toLowerCase(), cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
                return (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">{r.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.campaign_name ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.daily_budget != null ? fmtCurrency(r.daily_budget) : <span className="text-xs text-zinc-400">{r.cbo ? "na campanha" : "—"}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(r.spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.impressions.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.conversations}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        side === "acima" ? "text-red-600 dark:text-red-400" : side === "abaixo" ? "text-emerald-600 dark:text-emerald-400" : ""
                      }`}
                    >
                      {r.cpa != null ? fmtCurrency(r.cpa) : <span className="text-xs font-normal text-zinc-400">sem conversa</span>}
                      {target != null && r.cpa != null ? (
                        <div className="text-[11px] font-normal opacity-70">
                          {r.cpa - target >= 0 ? "+" : "−"}
                          {fmtCurrency(Math.abs(r.cpa - target))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-zinc-400">
            <a href={adsManagerUrl(data.accountId, "last_30d")} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted">
              Abrir a conta no Gerenciador ↗
            </a>{" "}
            · Ficam de fora as campanhas de vaga/seguidores/tráfego e objetivos que não contam pro CPA (mesma regra da Análise).
          </p>
        </div>
      ) : null}
    </div>
  );
}
