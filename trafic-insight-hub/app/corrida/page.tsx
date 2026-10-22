"use client";

// Etapa 189: "Corrida dos 20" — quadro pra deixar aberto na tela (pensado pra 1366×768), fora do menu e sem cabeçalho.
// Endereço: /corrida (pede login como o resto). Mostra TODAS as contas exibidas com CPA ideal cadastrado, pelo CPA do mês
// com a regra da Speed (lib/meta/speed.ts): OK, Aceitável (até R$ 1,20 acima) ou Acima. A meta da bonificação é 20 contas
// na meta (OK ou Aceitável) = 40 pontos de Performance da Carteira.
// - Teto daqui = CPA máximo nos dias que faltam pra fechar o mês Aceitável, supondo que a conta gaste a meta inteira:
//   (meta mensal − gasto até agora) ÷ (meta mensal ÷ (CPA ideal + 1,20) − conversas até agora).
// - Desde = CPA do período do plano (padrão 22/10; outro início: /corrida?desde=AAAA-MM-DD). Verde se está abaixo do teto.
// Busca: 2 chamadas por conta no máximo (mês e "desde", sem as de orçamento — skipBudget), dias fechados do backup diário.
// Atualiza sozinho a cada 20 min e no botão.

import { useCallback, useEffect, useMemo, useState } from "react";
import { SPEED_CPA_ACCEPTABLE, speedCpaStatus, type SpeedCpa } from "@/lib/meta/speed";
import type { AccountInsight } from "@/lib/meta/insights";

interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  cpa_target?: number | null;
  monthly_investment?: number | null;
  active?: boolean;
}

interface Row {
  id: string;
  name: string;
  meta: number;
  monthly: number | null;
  cpa: number | null;
  spend: number;
  conv: number;
  status: SpeedCpa | null;
  teto: number | null; // null = sem meta mensal
  livre: boolean; // já garantido: as conversas do mês já bastam
  desde: number | null;
  failed: boolean;
}

const REFRESH_MS = 20 * 60 * 1000;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const spDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const hm = (t: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(t);

function defaultDesde(): string {
  const today = spDay();
  try {
    const q = new URLSearchParams(window.location.search).get("desde");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= today) return q;
  } catch {
    /* sem URL */
  }
  // Plano começou em 22/10/2026; em outro mês, o padrão é o dia 01.
  return today.slice(0, 7) === "2026-10" ? "2026-10-22" : `${today.slice(0, 7)}-01`;
}

async function insights(ids: string[], datePreset: unknown): Promise<Record<string, AccountInsight>> {
  const res = await fetch("/api/meta/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ accountIds: ids, datePreset, skipBudget: true }),
  });
  const d = (await res.json()) as { insights?: Record<string, AccountInsight>; error?: string };
  if (!d.insights) throw new Error(d.error ?? "A Meta não respondeu.");
  return d.insights;
}

const TONE: Record<SpeedCpa, { text: string; border: string; pill: string; label: string }> = {
  ok: {
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-l-emerald-500",
    pill: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
    label: "OK",
  },
  acceptable: {
    text: "text-orange-600 dark:text-orange-400",
    border: "border-l-orange-400",
    pill: "border-orange-400 text-orange-700 dark:text-orange-300",
    label: "Aceitável",
  },
  high: {
    text: "text-red-600 dark:text-red-400",
    border: "border-l-red-500",
    pill: "border-red-500 text-red-700 dark:text-red-300",
    label: "Acima",
  },
};

// Régua: verde até o CPA ideal, laranja até + R$ 1,20, vermelho depois; tracinho = CPA do mês.
function Gauge({ cpa, meta }: { cpa: number | null; meta: number }) {
  const lim = meta + SPEED_CPA_ACCEPTABLE;
  const max = Math.max(lim * 1.5, (cpa ?? 0) * 1.08);
  const x = (v: number) => (v / max) * 100;
  return (
    <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="block h-3 w-full" aria-hidden="true">
      <rect x="0" y="3" height="6" width={x(meta)} className="fill-emerald-500/60" />
      <rect x={x(meta)} y="3" height="6" width={x(lim) - x(meta)} className="fill-orange-400/60" />
      <rect x={x(lim)} y="3" height="6" width={100 - x(lim)} className="fill-red-500/35" />
      {cpa != null ? <rect x={Math.min(98.5, Math.max(0, x(cpa) - 0.75))} y="0" width="1.5" height="12" className="fill-zinc-900 dark:fill-zinc-100" /> : null}
    </svg>
  );
}

function Tile({ r, desdeLabel }: { r: Row; desdeLabel: string }) {
  const t = r.status ? TONE[r.status] : null;
  const onTrack = r.livre || (r.desde != null && r.teto != null && r.desde <= r.teto);
  return (
    <article
      className={`flex min-h-[7.4rem] flex-col gap-1 rounded-lg border border-l-4 border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900 ${t ? t.border : "border-l-zinc-300"}`}
    >
      <header className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-50" title={r.name}>
          {r.name}
        </span>
        {t ? <span className={`shrink-0 rounded-full border px-1.5 text-[10px] leading-4 ${t.pill}`}>{t.label}</span> : null}
      </header>
      {r.failed ? (
        <p className="flex flex-1 items-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" /> A Meta não respondeu
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className={`font-serif text-2xl leading-none ${t ? t.text : "text-zinc-400"}`}>{r.cpa != null ? brl(r.cpa) : "—"}</span>
            <span className="text-[11px] text-zinc-500">meta {brl(r.meta)}</span>
          </div>
          <Gauge cpa={r.cpa} meta={r.meta} />
          <dl className="grid grid-cols-2 gap-1 tabular-nums">
            <div>
              <dt className="text-[10px] text-zinc-500">Teto daqui</dt>
              <dd className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {r.livre ? "livre" : r.teto != null ? brl(r.teto) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-zinc-500">Desde {desdeLabel}</dt>
              <dd className={`text-xs font-semibold ${r.desde == null ? "text-zinc-400" : onTrack ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {r.desde != null ? brl(r.desde) : "—"}
              </dd>
            </div>
          </dl>
        </>
      )}
    </article>
  );
}

function Section({ title, note, rows, desdeLabel }: { title: string; note: string; rows: Row[]; desdeLabel: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title} <span className="ml-1 font-normal text-zinc-500">· {rows.length} · {note}</span>
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-1.5">
        {rows.map((r) => (
          <Tile key={r.id} r={r} desdeLabel={desdeLabel} />
        ))}
      </div>
    </section>
  );
}

export default function CorridaPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [desde] = useState(defaultDesde);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/selected-accounts").then((r) => r.json()),
        fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json()),
      ]);
      const ids = new Set<string>((a.accountIds ?? []) as string[]);
      const list = ((b.bindings ?? []) as Binding[]).filter((x) => ids.has(x.ad_account_id) && x.active !== false && x.cpa_target != null);
      const accountIds = list.map((x) => x.ad_account_id);
      const today = spDay();
      const [month, since] = await Promise.all([
        insights(accountIds, "this_month"),
        insights(accountIds, { since: desde, until: today }).catch(() => ({}) as Record<string, AccountInsight>),
      ]);
      setRows(
        list.map((x) => {
          const m = Number(x.cpa_target);
          const T = x.monthly_investment != null && x.monthly_investment > 0 ? Number(x.monthly_investment) : null;
          const ins = month[x.ad_account_id];
          const failed = !ins || !!ins.insights_failed;
          const spend = failed ? 0 : ins.spend;
          const conv = failed ? 0 : (ins.results ?? 0);
          const cpa = failed ? null : ins.cost_per_result;
          const precisa = T != null ? T / (m + SPEED_CPA_ACCEPTABLE) - conv : null;
          const s = since[x.ad_account_id];
          return {
            id: x.ad_account_id,
            name: (x.client_name ?? "").trim() || x.ad_account_id,
            meta: m,
            monthly: T,
            cpa,
            spend,
            conv,
            status: failed ? null : speedCpaStatus(cpa, m),
            teto: T != null && precisa != null && precisa > 0 ? (T - spend) / precisa : null,
            livre: precisa != null && precisa <= 0,
            desde: s && !s.insights_failed ? s.cost_per_result : null,
            failed,
          };
        }),
      );
      setAt(Date.now());
    } catch (e) {
      const msg = (e as Error).message;
      setError(/failed to fetch|networkerror|load failed/i.test(msg) ? "Sem conexão com o servidor agora. Tentando de novo no próximo ciclo." : msg);
    } finally {
      setLoading(false);
    }
  }, [desde]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao abrir e a cada 20 min
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const desdeLabel = `${desde.slice(8, 10)}/${desde.slice(5, 7)}`;
  const g = useMemo(() => {
    const all = rows ?? [];
    // Busca pelo nome: só filtra os cartões; o placar continua contando todas as contas.
    const flat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const needle = flat(q.trim());
    const vis = needle ? all.filter((r) => flat(r.name).includes(needle)) : all;
    // Fora da meta: quem está no caminho (CPA desde o início do plano abaixo do teto) primeiro, depois o teto mais folgado.
    const score = (r: Row) => (r.teto != null ? r.teto / r.meta : -1) + (r.desde != null && r.teto != null && r.desde <= r.teto ? 10 : 0);
    const fora = vis.filter((r) => r.status === "high" || r.failed || r.status == null).sort((a, b) => score(b) - score(a));
    const segurar = vis.filter((r) => r.status === "acceptable").sort((a, b) => (a.teto ?? 99) - (b.teto ?? 99));
    const seguras = vis.filter((r) => r.status === "ok").sort((a, b) => (a.teto ?? 99) - (b.teto ?? 99));
    const na = all.filter((r) => r.status === "ok" || r.status === "acceptable").length;
    return { fora, segurar, seguras, na, total: all.length, shown: vis.length };
  }, [rows, q]);
  const GOAL = 20;
  const faltam = Math.max(0, GOAL - g.na);

  return (
    <div className="flex min-h-screen flex-col gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <h1 className="font-serif text-xl text-zinc-900 dark:text-zinc-50">Corrida dos 20</h1>
        <input
          id="corrida-busca"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar conta…"
          aria-label="Buscar conta pelo nome"
          className="h-7 w-44 rounded-md border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <div className="flex items-baseline gap-1.5 tabular-nums">
          <span className="font-serif text-4xl leading-none text-zinc-900 dark:text-zinc-50">{rows ? g.na : "—"}</span>
          <span className="text-sm text-zinc-500">de {rows ? g.total : "—"} contas na meta pelo CPA</span>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="grid h-3.5 gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.max(g.total, 1)}, minmax(0, 1fr))` }}>
            {Array.from({ length: g.total }, (_, i) => (
              <i
                key={i}
                className={`block rounded-sm ${i < g.na ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-800"} ${i === GOAL - 1 ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : ""}`}
              />
            ))}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {rows ? (faltam > 0 ? `Faltam ${faltam} pra ${GOAL} (40 pontos).` : `Meta de ${GOAL} batida.`) : "Carregando…"} Teto daqui = CPA máximo até o fim do mês pra fechar
            Aceitável. Desde {desdeLabel} = CPA dos dias do plano (verde: abaixo do teto).
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {at ? <span>atualizado às {hm(at)}</span> : null}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="h-7 rounded-md border border-zinc-300 px-2.5 font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            {loading ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </header>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {!rows && !error ? <p className="text-sm text-zinc-500">Buscando as contas na Meta…</p> : null}
      {rows ? (
        <>
          <Section title="Fora da meta" note="no caminho primeiro" rows={g.fora} desdeLabel={desdeLabel} />
          <Section title="Aceitável — segurar" note="perto do limite primeiro" rows={g.segurar} desdeLabel={desdeLabel} />
          <Section title="OK — seguras" note="só manter" rows={g.seguras} desdeLabel={desdeLabel} />
          {g.shown === 0 ? <p className="text-sm text-zinc-500">Nenhuma conta com “{q}”.</p> : null}
        </>
      ) : null}
    </div>
  );
}
