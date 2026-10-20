"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import { addDaysYmd } from "@/lib/meta/daily-range";
import type { AdAccount } from "@/lib/meta/insights";
import {
  GOOD_MIN_CONV,
  LOW_CONV_30D,
  LOW_SPEND_30D,
  RECENT_DAYS,
  summarizeVideos,
  type AccountVideoInput,
  type VideoSummary,
  type VideoTag,
} from "@/lib/meta/video-summary";

// Etapa 160: Análise → Vídeos. Mapa dos vídeos de GERAL (banco de vídeos) em todas as contas: quais são de alta performance mas estão parados,
// quais não são usados há tempo, quais foram pouco testados e onde o mesmo vídeo está ativo em mais de um conjunto. Só leitura.

const BATCH = 5;

interface Snapshot {
  computed_at: string;
  accounts: Record<string, AccountVideoInput & { computedFor: string; error?: string }>;
}

interface Cached {
  accounts: AccountVideoInput[];
  errors: string[];
  missing: number; // contas visíveis que ainda não entraram no retrato
  computedFor: string | null; // dia do cálculo mais antigo (os números vão até o dia anterior)
}

const TAGS: Record<VideoTag, { label: string; cls: string; hint: string }> = {
  alta: {
    label: "Alta performance, parado",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    hint: `CPA do mês ou dos 7 dias abaixo da meta (com ${GOOD_MIN_CONV}+ conversas) em alguma conta, e nenhum anúncio ativo dele em conta nenhuma.`,
  },
  parado: {
    label: "Não usado recentemente",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    hint: `Nenhum anúncio novo com esse vídeo há mais de ${RECENT_DAYS} dias (ou nunca usado).`,
  },
  pouco: {
    label: "Pouco testado",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    hint: `Usado, mas com menos de ${fmtCurrency(LOW_SPEND_30D)} de gasto ou menos de ${LOW_CONV_30D} conversas nos últimos 30 dias, somando as contas.`,
  },
  repetido: {
    label: "Ativo em 2+ conjuntos",
    cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    hint: "Está ativo em mais de um conjunto na mesma conta (em Geral você evita repetir o vídeo).",
  },
  fora: {
    label: "Fora do banco",
    cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    hint: 'Nome "GERAL | …" que não está na lista de vídeos do banco.',
  },
};

const FILTERS: Array<{ id: "todos" | VideoTag; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "alta", label: "Alta performance, parado" },
  { id: "parado", label: "Não usado recentemente" },
  { id: "pouco", label: "Pouco testado" },
  { id: "repetido", label: "Ativo em 2+ conjuntos" },
  { id: "fora", label: "Fora do banco" },
];

const cpaTxt = (v: number | null) => (v == null ? "—" : fmtCurrency(v));
const untilTxt = (computedFor: string) => {
  const y = addDaysYmd(computedFor, -1);
  return `${y.slice(8, 10)}/${y.slice(5, 7)}`;
};
const atTxt = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", " às");
const dayTxt = (d: number | null) => (d == null ? "nunca" : d <= 0 ? "hoje" : `há ${d} d`);

export function VideosGeral({ accounts }: { accounts: AdAccount[] }) {
  const [data, setData] = useState<Cached | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todos" | VideoTag>("todos");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const run = useRef(0);

  const ids = useMemo(() => accounts.map((a) => a.account_id), [accounts]);

  // Abre lendo o retrato guardado (números até ontem) — NÃO consulta a Meta.
  const readSnapshot = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/analysis/video-map");
      const d = (await res.json()) as { error?: string; snapshot?: Snapshot | null };
      if (d.error) throw new Error(d.error);
      const snap = d.snapshot ?? null;
      setSnapshotAt(snap?.computed_at ?? null);
      const wanted = new Set(ids);
      const list = Object.values(snap?.accounts ?? {}).filter((a) => wanted.has(a.accountId));
      const errs = list.filter((a) => a.error).map((a) => `${a.clientName}: ${(a.error ?? "").slice(0, 120)}`);
      const okList = list.filter((a) => !a.error);
      setData({
        accounts: okList.map((a) => ({ accountId: a.accountId, clientName: a.clientName, cpaTarget: a.cpaTarget, stats: a.stats })),
        errors: errs,
        missing: ids.length - list.length,
        computedFor: list.map((a) => a.computedFor).sort()[0] ?? null,
      });
    } catch (e) {
      setError((e as Error).message);
      setData({ accounts: [], errors: [], missing: ids.length, computedFor: null });
    }
  }, [ids]);

  // Botão "Atualizar": refaz tudo na Meta (até ontem) em lotes e guarda o novo retrato.
  const recalc = useCallback(async () => {
    if (ids.length === 0) return;
    const my = ++run.current;
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    const errors: string[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/analysis/video-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: batch }),
        });
        const d = (await res.json()) as { error?: string };
        if (d.error) errors.push(d.error);
      } catch (e) {
        errors.push((e as Error).message);
      }
      if (my !== run.current) return;
      setProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
    }
    await readSnapshot();
    setLoading(false);
    setProgress(null);
    if (errors.length > 0) setError(errors[0]);
  }, [ids, readSnapshot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o retrato guardado ao abrir a aba
    void readSnapshot();
  }, [readSnapshot]);

  const videos = useMemo(() => (data ? summarizeVideos(data.accounts) : []), [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: videos.length };
    for (const v of videos) for (const t of v.tags) c[t] = (c[t] ?? 0) + 1;
    return c;
  }, [videos]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return videos.filter((v) => (filter === "todos" || v.tags.includes(filter)) && (!needle || v.label.toLowerCase().includes(needle)));
  }, [videos, filter, q]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Vídeos de Geral</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Banco de vídeos em todas as contas com Meta CPA. Só leitura — nada é alterado.
            {data?.computedFor ? ` Números até ontem (${untilTxt(data.computedFor)}), atualizados de madrugada${snapshotAt ? ` — calculado ${atTxt(snapshotAt)}` : ""}. "Ativo" é a situação no momento do cálculo.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar vídeo"
            className="h-8 w-48 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={() => void recalc()}
            disabled={loading}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading && progress ? `Atualizando… ${progress.done}/${progress.total}` : data && data.accounts.length === 0 ? "Calcular agora" : "↻ Atualizar agora"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800/60">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            title={f.id === "todos" ? undefined : TAGS[f.id].hint}
            className={`h-7 rounded-full px-2.5 text-xs font-medium ${
              filter === f.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {f.label} ({counts[f.id] ?? 0})
          </button>
        ))}
      </div>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {data && data.accounts.length > 0 && data.missing > 0 ? (
        <p className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {data.missing} conta{data.missing === 1 ? "" : "s"} ainda não entrou no retrato (sem meta de CPA, nova ou ainda não calculada). Use "Atualizar agora" para incluir.
        </p>
      ) : null}
      {loading && progress ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          Calculando na Meta ({progress.done}/{progress.total} contas)… isso demora um pouco.
        </p>
      ) : !data ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : data.accounts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
          Ainda não há retrato guardado. Ele é calculado de madrugada; para ter agora, clique em "Calcular agora".
        </p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">Nenhum vídeo nessa situação.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-1.5 font-medium">Vídeo</th>
                <th className="px-4 py-1.5 font-medium">Situação</th>
                <th className="px-4 py-1.5 text-right font-medium">CPA 7 dias</th>
                <th className="px-4 py-1.5 text-right font-medium">CPA mês</th>
                <th className="px-4 py-1.5 text-right font-medium">Gasto 30d</th>
                <th className="px-4 py-1.5 text-right font-medium">Ativo em</th>
                <th className="px-4 py-1.5 text-right font-medium">Bom em</th>
                <th className="px-4 py-1.5 text-right font-medium">Último uso</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <Fragment key={v.key}>
                  <tr onClick={() => toggle(v.key)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-medium">
                      <span className="mr-1 text-xs text-zinc-400">{open.has(v.key) ? "▾" : "▸"}</span>
                      {v.label.replace(/^GERAL \| /, "")}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {v.tags.length === 0 ? <span className="text-xs text-zinc-400">—</span> : null}
                        {v.tags.map((t) => (
                          <span key={t} title={TAGS[t].hint} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${TAGS[t].cls}`}>
                            {TAGS[t].label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{cpaTxt(v.cpa7d)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{cpaTxt(v.cpaMonth)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(v.spend30)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.activeAccounts} conta{v.activeAccounts === 1 ? "" : "s"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{v.goodAccounts} conta{v.goodAccounts === 1 ? "" : "s"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-zinc-500 dark:text-zinc-400">{dayTxt(v.daysSinceLast)}</td>
                  </tr>
                  {open.has(v.key) ? (
                    <tr className="border-t border-zinc-100 dark:border-zinc-800/60">
                      <td colSpan={8} className="bg-zinc-50/60 px-4 py-2 dark:bg-zinc-800/20">
                        <AccountsTable v={v} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        “Bom” = CPA do mês ou dos 7 dias abaixo da Meta CPA da conta, com {GOOD_MIN_CONV}+ conversas. Só entram anúncios com nome no padrão “GERAL | …”
        (os nomes antigos ficam de fora). Limites usados: parado = mais de {RECENT_DAYS} dias; pouco testado = menos de {fmtCurrency(LOW_SPEND_30D)} ou menos de {LOW_CONV_30D} conversas em 30 dias.
        {data && data.errors.length > 0 ? ` Erro em ${data.errors.length} lote(s)/conta(s): ${data.errors[0].slice(0, 100)}` : ""}
      </p>
    </div>
  );
}

function AccountsTable({ v }: { v: VideoSummary }) {
  const rows = [...v.accounts].sort(
    (a, b) => (a.state === "ativo" ? 0 : a.state === "pausado" ? 1 : 2) - (b.state === "ativo" ? 0 : b.state === "pausado" ? 1 : 2) || a.clientName.localeCompare(b.clientName, "pt-BR"),
  );
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
          <th className="px-3 py-1 font-medium">Conta</th>
          <th className="px-3 py-1 font-medium">Nesta conta</th>
          <th className="px-3 py-1 text-right font-medium">CPA 7 dias</th>
          <th className="px-3 py-1 text-right font-medium">CPA mês</th>
          <th className="px-3 py-1 text-right font-medium">Meta</th>
          <th className="px-3 py-1 text-right font-medium">Gasto 30d</th>
          <th className="px-3 py-1 text-right font-medium">Último anúncio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.accountId} className="border-t border-zinc-100 dark:border-zinc-800/60">
            <td className="px-3 py-1.5">{r.clientName}</td>
            <td className="px-3 py-1.5">
              {r.state === "ativo" ? (
                <span className={r.activeAdsets >= 2 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                  ativo em {r.activeAdsets} conjunto{r.activeAdsets === 1 ? "" : "s"}
                </span>
              ) : r.state === "pausado" ? (
                <span className="text-zinc-500">pausado{v.goodAccounts > 0 && !r.good ? " · bom em outras contas" : ""}</span>
              ) : (
                <span className="text-zinc-400">nunca usado{v.goodAccounts > 0 ? " · bom em outras contas" : ""}</span>
              )}
              {r.good ? <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">bom aqui</span> : null}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">{cpaTxt(r.cpa7d)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{cpaTxt(r.cpaMonth)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{fmtCurrency(r.cpaTarget)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmtCurrency(r.spend30)}</td>
            <td className="px-3 py-1.5 text-right text-zinc-500 dark:text-zinc-400">{dayTxt(r.daysSinceCreated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
