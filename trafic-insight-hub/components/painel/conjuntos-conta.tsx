"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 217: Análise → "Conjuntos da conta". Escolhe UMA conta e só então busca na Meta (economiza requisição).
// Etapa 219: "Todos ativos" e "CPA acima/abaixo" usam ONTEM + HOJE; "Com impressão" usa os ÚLTIMOS 15 DIAS (inclui pausados).

interface Metrics {
  spend: number;
  impressions: number;
  conversations: number;
  cpa: number | null;
}
interface Row {
  id: string;
  name: string;
  campaign_name: string | null;
  campaign_status: string | null;
  status: string;
  daily_budget: number | null;
  cbo: boolean;
  created_time: string | null;
  d2: Metrics; // ontem + hoje
  d15: Metrics; // últimos 15 dias
}
interface Data {
  accountId: string;
  clientName: string;
  cpaTarget: number | null;
  fetchedAt: string;
  adsets: Row[];
}
function statusBadge(status: string | null) {
  const st = (status && STATUS[status]) || { label: (status ?? "—").toLowerCase(), cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>;
}

// Etapa 220: criativo de um conjunto (aberto ao clicar no conjunto).
interface AdRow {
  id: string;
  name: string;
  status: string;
  created_time: string | null;
  spend: number;
  impressions: number;
  conversations: number;
  cpl: number | null;
}

const periodOf = (f: FilterId): "d2" | "d15" => (f === "impressao" ? "d15" : "d2");
const PERIOD_LABEL = { d2: "ontem + hoje", d15: "últimos 15 dias" } as const;

type FilterId = "ativos" | "impressao" | "acima" | "abaixo";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "ativos", label: "Todos ativos" },
  { id: "impressao", label: "Com impressão nos 15 dias (inclui pausados)" },
  { id: "acima", label: "CPA acima da meta" },
  { id: "abaixo", label: "CPA abaixo da meta" },
];

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Ativo", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  PAUSED: { label: "Pausado", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  CAMPAIGN_PAUSED: { label: "Campanha pausada", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  IN_PROCESS: { label: "Processando", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  WITH_ISSUES: { label: "Com problema", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  ADSET_PAUSED: { label: "Conjunto pausado", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  PENDING_REVIEW: { label: "Em análise", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  PREAPPROVED: { label: "Pré-aprovado", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  DISAPPROVED: { label: "Reprovado", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  PENDING_BILLING_INFO: { label: "Cobrança pendente", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

// Acima: com conversa e CPA acima da meta, ou sem conversa e gasto acima da meta. Abaixo: com conversa e CPA na meta ou abaixo.
function cpaSide(m: Metrics, target: number | null): "acima" | "abaixo" | null {
  if (target == null || m.impressions <= 0) return null;
  if (m.conversations > 0 && m.cpa != null) return m.cpa > target ? "acima" : "abaixo";
  return m.spend > target ? "acima" : null;
}

export function ConjuntosConta({ accounts }: { accounts: AdAccount[] }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState("");
  const [filter, setFilter] = useState<FilterId>("ativos");
  const [cache, setCache] = useState<Record<string, Data>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Etapa 218: ações por conjunto — pausar, reativar e mudar o orçamento diário.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [newBudget, setNewBudget] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Etapa 220: criativos por conjunto (busca só ao abrir; guarda por conjunto + período).
  const [openId, setOpenId] = useState<string | null>(null);
  const [adsCache, setAdsCache] = useState<Record<string, AdRow[] | { error: string }>>({});

  async function toggleAds(r: Row) {
    if (openId === r.id) {
      setOpenId(null);
      return;
    }
    setOpenId(r.id);
    const key = `${r.id}|${periodOf(filter)}`;
    if (adsCache[key]) return;
    try {
      const res = await fetch("/api/analysis/adset-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsetId: r.id, period: periodOf(filter) }),
      });
      const d = await res.json();
      setAdsCache((c) => ({ ...c, [key]: d.error ? { error: d.error } : (d.ads as AdRow[]) }));
    } catch (e) {
      setAdsCache((c) => ({ ...c, [key]: { error: (e as Error).message } }));
    }
  }

  async function setAdStatus(adsetId: string, ad: AdRow, status: "ACTIVE" | "PAUSED") {
    if (status === "PAUSED" && !confirm(`Pausar o criativo "${ad.name}"?`)) return;
    setBusyId(ad.id);
    setNotice(null);
    try {
      const res = await fetch("/api/meta/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: ad.id, type: "ad" }], status }),
      });
      const d = await res.json();
      const result = d.results?.[0];
      if (!result?.ok) throw new Error(result?.error ?? d.error ?? "Erro desconhecido");
      setAdsCache((c) => {
        const next = { ...c };
        for (const k of Object.keys(next)) {
          const v = next[k];
          if (k.startsWith(`${adsetId}|`) && Array.isArray(v)) next[k] = v.map((a) => (a.id === ad.id ? { ...a, status } : a));
        }
        return next;
      });
      setNotice({ ok: true, text: `Criativo ${status === "PAUSED" ? "pausado" : "reativado"}: ${ad.name}` });
    } catch (e) {
      setNotice({ ok: false, text: `Não deu pra ${status === "PAUSED" ? "pausar" : "reativar"} o criativo: ${(e as Error).message}` });
    } finally {
      setBusyId(null);
    }
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setCache((c) => {
      const d = c[accountId];
      if (!d) return c;
      return { ...c, [accountId]: { ...d, adsets: d.adsets.map((r) => (r.id === id ? { ...r, ...patch } : r)) } };
    });
  }

  async function setStatus(r: Row, status: "ACTIVE" | "PAUSED") {
    if (status === "PAUSED" && !confirm(`Pausar o conjunto "${r.name}"?`)) return;
    setBusyId(r.id);
    setNotice(null);
    try {
      const res = await fetch("/api/meta/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: r.id, type: "adset" }], status }),
      });
      const d = await res.json();
      const result = d.results?.[0];
      if (!result?.ok) throw new Error(result?.error ?? d.error ?? "Erro desconhecido");
      patchRow(r.id, { status });
      setNotice({ ok: true, text: `${status === "PAUSED" ? "Pausado" : "Reativado"}: ${r.name}` });
    } catch (e) {
      setNotice({ ok: false, text: `Não deu pra ${status === "PAUSED" ? "pausar" : "reativar"}: ${(e as Error).message}` });
    } finally {
      setBusyId(null);
    }
  }

  async function saveBudget(r: Row) {
    const value = Number(newBudget.replace(",", "."));
    if (!Number.isFinite(value) || value < 6) {
      setNotice({ ok: false, text: "Orçamento mínimo de R$ 6,00." });
      return;
    }
    setBusyId(r.id);
    setNotice(null);
    try {
      const res = await fetch("/api/analysis/set-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsetId: r.id, dailyBudget: value }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "Erro desconhecido");
      if (d.scope === "adset") patchRow(r.id, { daily_budget: d.newBudget });
      setEditId(null);
      setNotice({
        ok: true,
        text:
          d.scope === "campaign"
            ? `Orçamento da CAMPANHA (CBO) de ${r.name}: ${fmtCurrency(d.fromBudget)} → ${fmtCurrency(d.newBudget)}`
            : `Orçamento de ${r.name}: ${fmtCurrency(d.fromBudget)} → ${fmtCurrency(d.newBudget)}`,
      });
    } catch (e) {
      setNotice({ ok: false, text: `Não deu pra mudar o orçamento: ${(e as Error).message}` });
    } finally {
      setBusyId(null);
    }
  }

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
      if (r.d15.impressions > 0) c.impressao++;
      const side = cpaSide(r.d2, target);
      if (side) c[side]++;
    }
    return c;
  }, [data, target]);
  const rows = useMemo(() => {
    const per = periodOf(filter);
    const list = (data?.adsets ?? []).filter((r) =>
      filter === "ativos" ? r.status === "ACTIVE" : filter === "impressao" ? r.d15.impressions > 0 : cpaSide(r.d2, target) === filter,
    );
    const key = (r: Row) => r[per].cpa ?? (r[per].spend > 0 ? r[per].spend : Number.POSITIVE_INFINITY);
    return list.sort((a, b) =>
      filter === "abaixo" ? key(a) - key(b) : filter === "acima" ? key(b) - key(a) : b[per].spend - a[per].spend,
    );
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
            Números de {PERIOD_LABEL[periodOf(filter)]} · CPA ideal {target != null ? fmtCurrency(target) : "não cadastrado"} · buscado às{" "}
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
      {notice ? (
        <p className={`px-4 py-2 text-sm ${notice.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}`}>{notice.text}</p>
      ) : null}
      {accountId && loading && !data ? <p className="px-4 py-6 text-sm text-zinc-500">Buscando na Meta…</p> : null}
      {data && rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">Nenhum conjunto nesse filtro.</p> : null}

      {data && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-1.5 font-medium">Conjunto</th>
                <th className="px-3 py-1.5 font-medium">Status campanha</th>
                <th className="px-3 py-1.5 font-medium">Status conjunto</th>
                <th className="px-3 py-1.5 text-right font-medium">Orçamento/dia</th>
                <th className="px-3 py-1.5 text-right font-medium">Gasto</th>
                <th className="px-3 py-1.5 text-right font-medium">Impressões</th>
                <th className="px-3 py-1.5 text-right font-medium">Conversas</th>
                <th className="px-3 py-1.5 text-right font-medium">CPA ({PERIOD_LABEL[periodOf(filter)]})</th>
                <th className="px-3 py-1.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r[periodOf(filter)];
                const side = cpaSide(m, target);
                const st = STATUS[r.status] ?? { label: r.status.toLowerCase(), cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
                return (
                  <Fragment key={r.id}>
                  <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-2">
                      <button onClick={() => void toggleAds(r)} className="text-left" title="Ver os criativos deste conjunto">
                        <span className="mr-1 inline-block w-3 text-zinc-400">{openId === r.id ? "▾" : "▸"}</span>
                        <span className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">{r.name}</span>
                      </button>
                      <div className="pl-4 text-xs text-zinc-500 dark:text-zinc-400">{r.campaign_name ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">{statusBadge(r.campaign_status)}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.daily_budget != null ? fmtCurrency(r.daily_budget) : <span className="text-xs text-zinc-400">{r.cbo ? "na campanha" : "—"}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(m.spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.impressions.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.conversations}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        side === "acima" ? "text-red-600 dark:text-red-400" : side === "abaixo" ? "text-emerald-600 dark:text-emerald-400" : ""
                      }`}
                    >
                      {m.cpa != null ? fmtCurrency(m.cpa) : <span className="text-xs font-normal text-zinc-400">sem conversa</span>}
                      {target != null && m.cpa != null ? (
                        <div className="text-[11px] font-normal opacity-70">
                          {m.cpa - target >= 0 ? "+" : "−"}
                          {fmtCurrency(Math.abs(m.cpa - target))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editId === r.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <span className="text-xs text-zinc-500">R$</span>
                          <input
                            value={newBudget}
                            onChange={(e) => setNewBudget(e.target.value)}
                            inputMode="decimal"
                            className="h-7 w-16 rounded border border-zinc-300 bg-transparent px-1.5 text-right text-sm dark:border-zinc-700"
                          />
                          {[5, 10].map((inc) => (
                            <button
                              key={inc}
                              onClick={() => setNewBudget(String(((Number(newBudget.replace(",", ".")) || 0) + inc).toFixed(2)))}
                              className="h-7 rounded border border-zinc-300 px-1.5 text-xs dark:border-zinc-700"
                            >
                              +{inc}
                            </button>
                          ))}
                          <button
                            onClick={() => void saveBudget(r)}
                            disabled={busyId === r.id}
                            className="h-7 rounded bg-zinc-900 px-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                          >
                            {busyId === r.id ? "…" : "Salvar"}
                          </button>
                          <button onClick={() => setEditId(null)} className="h-7 px-1 text-xs text-zinc-500">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {r.status === "ACTIVE" ? (
                            <button
                              onClick={() => void setStatus(r, "PAUSED")}
                              disabled={busyId === r.id}
                              className="h-7 rounded border border-red-300 px-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            >
                              Pausar
                            </button>
                          ) : r.status === "PAUSED" ? (
                            <button
                              onClick={() => void setStatus(r, "ACTIVE")}
                              disabled={busyId === r.id}
                              className="h-7 rounded border border-emerald-400 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                            >
                              Reativar
                            </button>
                          ) : null}
                          <button
                            onClick={() => {
                              setEditId(r.id);
                              setNewBudget(r.daily_budget != null ? (r.daily_budget + 5).toFixed(2) : "");
                            }}
                            disabled={busyId === r.id}
                            title={r.cbo ? "Orçamento na campanha (CBO): muda o orçamento da campanha inteira" : "Mudar o orçamento diário do conjunto"}
                            className="h-7 rounded border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Orçamento
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {openId === r.id ? (
                    <tr className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/60 dark:bg-zinc-950/40">
                      <td colSpan={9} className="px-6 py-2">
                        {(() => {
                          const v = adsCache[`${r.id}|${periodOf(filter)}`];
                          if (!v) return <p className="text-xs text-zinc-500">Buscando os criativos…</p>;
                          if (!Array.isArray(v)) return <p className="text-xs text-red-600">{v.error}</p>;
                          if (v.length === 0) return <p className="text-xs text-zinc-500">Nenhum criativo neste conjunto.</p>;
                          return (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                                  <th className="py-1 font-medium">Criativo</th>
                                  <th className="px-2 py-1 font-medium">Status</th>
                                  <th className="px-2 py-1 text-right font-medium">Gasto</th>
                                  <th className="px-2 py-1 text-right font-medium">Conversas</th>
                                  <th className="px-2 py-1 text-right font-medium">Custo por lead</th>
                                  <th className="px-2 py-1 text-right font-medium">Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.map((a) => {
                                  const aside = target == null ? null : a.cpl != null ? (a.cpl > target ? "acima" : "abaixo") : a.spend > target ? "acima" : null;
                                  return (
                                    <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                                      <td className="py-1.5 pr-2 text-zinc-800 dark:text-zinc-200">{a.name}</td>
                                      <td className="px-2 py-1.5">{statusBadge(a.status)}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(a.spend)}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums">{a.conversations}</td>
                                      <td
                                        className={`px-2 py-1.5 text-right font-semibold tabular-nums ${
                                          aside === "acima" ? "text-red-600 dark:text-red-400" : aside === "abaixo" ? "text-emerald-600 dark:text-emerald-400" : ""
                                        }`}
                                      >
                                        {a.cpl != null ? fmtCurrency(a.cpl) : <span className="font-normal text-zinc-400">{a.spend > 0 ? "sem lead" : "—"}</span>}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {a.status === "ACTIVE" ? (
                                          <button
                                            onClick={() => void setAdStatus(r.id, a, "PAUSED")}
                                            disabled={busyId === a.id}
                                            className="h-6 rounded border border-red-300 px-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                          >
                                            Pausar
                                          </button>
                                        ) : a.status === "PAUSED" ? (
                                          <button
                                            onClick={() => void setAdStatus(r.id, a, "ACTIVE")}
                                            disabled={busyId === a.id}
                                            className="h-6 rounded border border-emerald-400 px-2 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                                          >
                                            Reativar
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          );
                        })()}
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Números de {PERIOD_LABEL[periodOf(filter)]}. Custo por lead = gasto ÷ conversas iniciadas no WhatsApp.
                        </p>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-zinc-400">
            <a href={adsManagerUrl(data.accountId, "today_yesterday")} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted">
              Abrir a conta no Gerenciador ↗
            </a>{" "}
            · Ficam de fora as campanhas de vaga/seguidores/tráfego e objetivos que não contam pro CPA (mesma regra da Análise).
          </p>
        </div>
      ) : null}
    </div>
  );
}
