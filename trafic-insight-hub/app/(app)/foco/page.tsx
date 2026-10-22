"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContaLateral } from "@/components/foco/conta-filtros";
import { FocoDescricao } from "@/components/foco/foco-descricao";
import { FocoMetas } from "@/components/foco/foco-metas";
import { FocoOfertas } from "@/components/foco/foco-ofertas";
import { FocoResultados } from "@/components/foco/foco-resultados";
import { PublicoTab } from "@/components/painel/publico-tab";
import { VideosGeral } from "@/components/painel/videos-geral";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import type { AccountInsight } from "@/lib/meta/insights";
import { monthCalendarSP } from "@/lib/meta/ritmo";

// Modo Foco: uma conta só, tudo numa tela — Acompanhamento de Resultados (metade de cima), Acompanhamento de metas e Análise (Vídeos de Geral /
// Melhor público) embaixo. A conta escolhida fica na própria aba do navegador (endereço ?conta=…), então dá pra deixar uma conta diferente em cada aba.

interface Opt {
  id: string;
  name: string;
  cpaTarget: number | null;
  monthlyInvestment: number | null;
  optimized: boolean;
  priority: string | null;
  sortOrder: number | null;
  whatsapp: string | null;
}
interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  cpa_target?: number | null;
  monthly_investment?: number | null;
  optimized?: boolean;
  priority?: string | null;
  sort_order?: number | null;
  whatsapp_contact?: string | null;
  active?: boolean;
}

const LAST_KEY = "foco_last_account";

function atTxt(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

function Quadro({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
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
  // Etapa 185: gasto do dia 01 até ONTEM — é o número que a Speed mostra (status do investimento igual ao dela).
  const [untilYesterday, setUntilYesterday] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [savingOpt, setSavingOpt] = useState(false);
  const [listOpen, setListOpen] = useState(true);
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
            optimized: !!x.optimized,
            priority: x.priority ?? null,
            sortOrder: x.sort_order ?? null,
            whatsapp: x.whatsapp_contact ?? null,
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
      const firstDay = monthCalendarSP().day === 1;
      const [dRes, iRes, yRes] = await Promise.all([
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
        // Dias fechados vêm do backup diário (Supabase) — normalmente nem chega na Meta.
        firstDay
          ? Promise.resolve(null)
          : fetch("/api/meta/insights", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(90_000),
              body: JSON.stringify({ accountIds: [id], datePreset: "this_month_until_yesterday", spendOnly: true }),
            })
              .then((r) => r.json())
              .catch(() => null),
      ]);
      if (my !== run.current) return;
      if (dRes.error) throw new Error(dRes.error);
      setDaily((dRes.daily?.[id] ?? []) as DailyCpaPoint[]);
      setMonth((dRes.month?.[id] ?? null) as DailyCpaPoint | null);
      setInsight((iRes.insights?.[id] ?? null) as AccountInsight | null);
      const y = (yRes as { insights?: Record<string, AccountInsight> } | null)?.insights?.[id];
      setUntilYesterday(firstDay ? 0 : y && !y.insights_failed ? y.spend : null);
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

  // Otimizado × Pendente: a mesma marcação da coluna Otimizado do Desempenho (vale pro dia de hoje). Avisa o Painel aberto em outra aba na hora.
  async function toggleOptimized(o: Opt) {
    const next = !o.optimized;
    setSavingOpt(true);
    setOpts((prev) => (prev ?? []).map((x) => (x.id === o.id ? { ...x, optimized: next } : x)));
    try {
      const res = await fetch("/api/account-bindings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: o.id, optimized: next }),
      });
      const d = (await res.json().catch(() => ({ error: "Resposta inválida do servidor." }))) as { error?: string };
      if (d.error) throw new Error(d.error);
      try {
        const ch = new BroadcastChannel("trafic-bindings");
        ch.postMessage({ accountId: o.id, patch: { optimized: next } });
        ch.close();
      } catch {
        /* sem BroadcastChannel: o Painel relê ao voltar pra aba */
      }
    } catch (e) {
      setOpts((prev) => (prev ?? []).map((x) => (x.id === o.id ? { ...x, optimized: !next } : x)));
      setError(`Não deu pra salvar: ${(e as Error).message}`);
    } finally {
      setSavingOpt(false);
    }
  }

  const opt = useMemo(() => opts?.find((o) => o.id === sel) ?? null, [opts, sel]);
  const optList = useMemo(() => opts ?? [], [opts]);

  return (
    <div className="flex flex-col gap-3 p-3 lg:h-[calc(100vh-3.6rem)] lg:flex-row">
      {listOpen ? (
        <aside className="flex min-h-0 shrink-0 flex-col max-lg:h-[26rem] lg:w-[21rem]">
          <ContaLateral opts={optList} value={sel} onChoose={choose} />
        </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <button
          onClick={() => setListOpen((v) => !v)}
          title={listOpen ? "Esconder a lista de clientes" : "Mostrar a lista de clientes"}
          className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700"
        >
          {listOpen ? "◀ Lista" : "▶ Lista"}
        </button>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{opt ? opt.name : "Foco"}</span>
        {opt ? (
          <>
            <button
              onClick={() => void toggleOptimized(opt)}
              disabled={savingOpt}
              title={opt.optimized ? "Marcada como otimizada hoje — clique pra voltar a Pendente" : "Clique pra marcar como otimizada hoje"}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                opt.optimized
                  ? "border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${opt.optimized ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
              {opt.optimized ? "Otimizado" : "Pendente"}
            </button>
            <button
              onClick={() => void load(opt.id)}
              disabled={loading}
              className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
            >
              {loading ? "Atualizando…" : "↻ Atualizar"}
            </button>
            {at ? <span className="text-xs text-zinc-400">{atTxt(at)}</span> : null}
            <a
              href={adsManagerUrl(opt.id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir o Gerenciador de Anúncios desta conta"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-300 px-2.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40"
            >
              Gerenciador <span aria-hidden>↗</span>
            </a>
            {opt.whatsapp?.trim() ? (
              <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50" title="WhatsApp do cliente">
                {opt.whatsapp.trim()}
              </span>
            ) : null}
          </>
        ) : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {!opt ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Escolha um cliente na lista ao lado para abrir o modo Foco.
        </div>
      ) : (
        <div key={opt.id} className="grid min-h-0 flex-1 gap-3 lg:grid-rows-[minmax(0,11fr)_minmax(0,12fr)]">
          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Quadro title="Acompanhamento de Resultados" className="min-h-[16rem]">
              <FocoResultados daily={daily} month={month} cpaTarget={opt.cpaTarget} insight={insight} monthlyTarget={opt.monthlyInvestment} untilYesterday={untilYesterday} />
            </Quadro>
            <Quadro title="Acompanhamento de metas" className="min-h-[16rem]">
              <FocoMetas insight={insight} untilYesterday={untilYesterday} cpaTarget={opt.cpaTarget} monthlyTarget={opt.monthlyInvestment} />
            </Quadro>
            <div className="flex min-h-[16rem] min-w-0 flex-col gap-3 lg:min-h-0">
              <Quadro title="Ofertas ativas" className="shrink-0">
                <FocoOfertas accountId={opt.id} />
              </Quadro>
              <Quadro title="Descrição (Asana)" className="min-h-[9rem] flex-1">
                <FocoDescricao accountId={opt.id} />
              </Quadro>
            </div>
          </div>
          <div className="grid min-h-0 gap-3 lg:grid-cols-2">
            <Quadro title="Vídeos (Geral)" className="min-h-[22rem]">
              <div className="[&>div]:rounded-none [&>div]:border-0">
                <VideosGeral accounts={[{ account_id: opt.id }]} focusAccountId={opt.id} />
              </div>
            </Quadro>
            <Quadro title="Melhor público" className="min-h-[22rem]">
              <div className="[&>div]:rounded-none [&>div]:border-0">
                <PublicoTab focusAccountId={opt.id} />
              </div>
            </Quadro>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
