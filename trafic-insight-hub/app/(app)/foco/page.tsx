"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocoMetas } from "@/components/foco/foco-metas";
import { FocoResultados } from "@/components/foco/foco-resultados";
import { PublicoTab } from "@/components/painel/publico-tab";
import { VideosGeral } from "@/components/painel/videos-geral";
import { fmtCurrency } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import type { AccountInsight } from "@/lib/meta/insights";

// Modo Foco: uma conta só, tudo numa tela — Acompanhamento de Resultados (metade de cima), Acompanhamento de metas e Análise (Vídeos de Geral /
// Melhor público) embaixo. A conta escolhida fica na própria aba do navegador (endereço ?conta=…), então dá pra deixar uma conta diferente em cada aba.

interface Opt {
  id: string;
  name: string;
  cpaTarget: number | null;
  monthlyInvestment: number | null;
}
interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  cpa_target?: number | null;
  monthly_investment?: number | null;
  active?: boolean;
}

const LAST_KEY = "foco_last_account";

function atTxt(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

function Quadro({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {right}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export default function FocoPage() {
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [sel, setSel] = useState("");
  const [daily, setDaily] = useState<DailyCpaPoint[]>([]);
  const [month, setMonth] = useState<DailyCpaPoint | null>(null);
  const [insight, setInsight] = useState<AccountInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [analise, setAnalise] = useState<"videos" | "publico">("videos");
  const run = useRef(0);

  // Contas dos clientes ativos que aparecem no Painel (só Supabase — barato).
  useEffect(() => {
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/selected-accounts").then((r) => r.json()),
          fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json()),
        ]);
        const ids = new Set<string>((a.accountIds ?? []) as string[]);
        const list: Opt[] = ((b.bindings ?? []) as Binding[])
          .filter((x) => ids.has(x.ad_account_id) && x.active !== false)
          .map((x) => ({
            id: x.ad_account_id,
            name: (x.client_name ?? "").trim() || x.ad_account_id,
            cpaTarget: x.cpa_target ?? null,
            monthlyInvestment: x.monthly_investment ?? null,
          }))
          .sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
        setOpts(list);
        let initial = "";
        try {
          initial = new URLSearchParams(window.location.search).get("conta") ?? "";
          if (!list.some((o) => o.id === initial)) initial = localStorage.getItem(LAST_KEY) ?? "";
        } catch {
          /* sem armazenamento */
        }
        if (list.some((o) => o.id === initial)) setSel(initial);
      } catch (e) {
        setError((e as Error).message);
        setOpts([]);
      }
    })();
  }, []);

  const choose = useCallback((id: string) => {
    setSel(id);
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("conta", id);
      else url.searchParams.delete("conta");
      window.history.replaceState(null, "", url.toString());
      if (id) localStorage.setItem(LAST_KEY, id);
    } catch {
      /* segue sem guardar */
    }
  }, []);

  const load = useCallback(async (id: string) => {
    const my = ++run.current;
    setLoading(true);
    setError(null);
    try {
      const [dRes, iRes] = await Promise.all([
        fetch("/api/meta/daily-cpa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({ accountIds: [id], days: 14, includeToday: true, includeMonth: true }),
        }).then((r) => r.json()),
        fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({ accountIds: [id], datePreset: "this_month" }),
        }).then((r) => r.json()),
      ]);
      if (my !== run.current) return;
      if (dRes.error) throw new Error(dRes.error);
      setDaily((dRes.daily?.[id] ?? []) as DailyCpaPoint[]);
      setMonth((dRes.month?.[id] ?? null) as DailyCpaPoint | null);
      setInsight((iRes.insights?.[id] ?? null) as AccountInsight | null);
      if (iRes.error) setError(String(iRes.error));
      setAt(Date.now());
    } catch (e) {
      if (my === run.current) setError((e as Error).message);
    } finally {
      if (my === run.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sel) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca os números da conta escolhida
    void load(sel);
  }, [sel, load]);

  const opt = useMemo(() => opts?.find((o) => o.id === sel) ?? null, [opts, sel]);

  return (
    <div className="flex flex-col gap-3 p-3 lg:h-[calc(100vh-3.6rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Foco</span>
        <select
          value={sel}
          onChange={(e) => choose(e.target.value)}
          className="h-9 min-w-[16rem] rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{opts ? "Escolha uma conta…" : "Carregando contas…"}</option>
          {(opts ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {opt ? (
          <>
            <a
              href={adsManagerUrl(opt.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Abrir no Gerenciador
            </a>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              CPA ideal {opt.cpaTarget != null ? fmtCurrency(opt.cpaTarget) : "—"} · Investimento mensal {opt.monthlyInvestment != null ? fmtCurrency(opt.monthlyInvestment) : "—"}
            </span>
            <button
              onClick={() => void load(opt.id)}
              disabled={loading}
              className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
            >
              {loading ? "Atualizando…" : "↻ Atualizar"}
            </button>
            {at ? <span className="text-xs text-zinc-400">atualizado às {atTxt(at)}</span> : null}
          </>
        ) : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {!opt ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Escolha uma conta para abrir o modo Foco.
        </div>
      ) : (
        <div key={opt.id} className="grid min-h-0 flex-1 gap-3 lg:grid-rows-2">
          <Quadro title={`Acompanhamento de Resultados${loading ? " · atualizando…" : ""}`} className="min-h-[18rem]">
            <FocoResultados daily={daily} month={month} cpaTarget={opt.cpaTarget} />
          </Quadro>
          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]">
            <Quadro title={`Acompanhamento de metas${loading ? " · atualizando…" : ""}`} className="min-h-[18rem]">
              <FocoMetas insight={insight} cpaTarget={opt.cpaTarget} monthlyTarget={opt.monthlyInvestment} />
            </Quadro>
            <Quadro
              title="Análise"
              className="min-h-[22rem]"
              right={
                <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
                  {([
                    ["videos", "Vídeos (Geral)"],
                    ["publico", "Melhor público"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setAnalise(id)}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        analise === id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              <div className={`[&>div]:rounded-none [&>div]:border-0 ${analise === "videos" ? "" : "hidden"}`}>
                <VideosGeral accounts={[{ account_id: opt.id }]} focusAccountId={opt.id} />
              </div>
              <div className={`[&>div]:rounded-none [&>div]:border-0 ${analise === "publico" ? "" : "hidden"}`}>
                <PublicoTab focusAccountId={opt.id} />
              </div>
            </Quadro>
          </div>
        </div>
      )}
    </div>
  );
}
