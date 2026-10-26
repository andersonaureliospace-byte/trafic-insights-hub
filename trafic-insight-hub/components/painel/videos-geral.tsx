"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import { addDaysYmd } from "@/lib/meta/daily-range";
import {
  CARO_MARGEM,
  GOOD_MIN_CONV,
  LOW_CONV_30D,
  LOW_SPEND_30D,
  RECENT_DAYS,
  summarizeAccounts,
  summarizeVideos,
  type AccountSummary,
  type AccountVideoInput,
  type AccountVideoTag,
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
    hint: `CPA médio dos últimos 30 dias abaixo da meta (com ${GOOD_MIN_CONV}+ conversas) em alguma conta, e nenhum anúncio ativo dele em conta nenhuma.`,
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
};

const CONTA_TAGS: Record<AccountVideoTag, { label: string; short: string; cls: string; hint: string }> = {
  reativar: {
    label: "Bom, reativar/duplicar",
    short: "Reativar",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    hint: `Nessa conta o CPA médio dos últimos 30 dias está abaixo da meta (${GOOD_MIN_CONV}+ conversas) e não há anúncio ativo dele.`,
  },
  repetido: {
    label: "Ativo em 2+ conjuntos",
    short: "Repetido",
    cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    hint: "Está ativo em mais de um conjunto dessa conta.",
  },
  nunca: {
    label: "Nunca usado aqui",
    short: "Nunca usado",
    cls: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
    hint: "Nenhum anúncio com esse vídeo nessa conta — candidato a teste.",
  },
  parado: {
    label: "Parado há tempo",
    short: "Parado",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    hint: `Já usado na conta, sem anúncio ativo e último anúncio criado há mais de ${RECENT_DAYS} dias.`,
  },
  pouco: {
    label: "Pouco testado",
    short: "Pouco testado",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    hint: `Usado, mas com menos de ${fmtCurrency(LOW_SPEND_30D)} ou menos de ${LOW_CONV_30D} conversas nos últimos 30 dias nessa conta.`,
  },
  caro: {
    label: "Caro (evitar)",
    short: "Caro",
    cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
    hint: `CPA ${fmtCurrency(CARO_MARGEM)} ou mais acima da meta da conta (CPA médio dos últimos 30 dias), com ${GOOD_MIN_CONV}+ conversas.`,
  },
};

const CONTA_FILTERS: Array<{ id: "todos" | AccountVideoTag; label: string }> = [
  { id: "todos", label: "Todas as contas" },
  { id: "reativar", label: "Com vídeo bom pra reativar" },
  { id: "repetido", label: "Com vídeo repetido" },
  { id: "nunca", label: "Com vídeo nunca usado" },
  { id: "parado", label: "Com vídeo parado" },
  { id: "pouco", label: "Com vídeo pouco testado" },
  { id: "caro", label: "Com vídeo caro" },
];

// Com uma conta escolhida, os filtros passam a contar VÍDEOS daquela conta.
const CONTA_VIDEO_LABELS: Record<"todos" | AccountVideoTag, string> = {
  todos: "Todos os vídeos",
  reativar: "Bom pra reativar",
  repetido: "Repetido",
  nunca: "Nunca usado",
  parado: "Parado",
  pouco: "Pouco testado",
  caro: "Caro",
};

const FILTERS: Array<{ id: "todos" | VideoTag; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "alta", label: "Alta performance, parado" },
  { id: "parado", label: "Não usado recentemente" },
  { id: "pouco", label: "Pouco testado" },
  { id: "repetido", label: "Ativo em 2+ conjuntos" },
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

// `focusAccountId` (modo Foco): a tela fica presa numa conta só — sem seletor, sem "Por vídeo", só os vídeos dela — e o Atualizar refaz só ela.
export function VideosGeral({ accounts, focusAccountId }: { accounts: Array<{ account_id: string }>; focusAccountId?: string }) {
  const [data, setData] = useState<Cached | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [bank, setBank] = useState<string[]>([]); // lista de vídeos (Configurações → Vídeos gerais)
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"conta" | "video">("conta");
  const [filter, setFilter] = useState<"todos" | VideoTag>("todos");
  const [filterConta, setFilterConta] = useState<"todos" | AccountVideoTag>("todos");
  const [q, setQ] = useState("");
  const [contaSel, setContaSel] = useState(focusAccountId ?? ""); // conta escolhida no seletor ("" = todas)
  const focus = !!focusAccountId;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const run = useRef(0);

  const ids = useMemo(() => (focusAccountId ? [focusAccountId] : accounts.map((a) => a.account_id)), [accounts, focusAccountId]);

  // Abre lendo o retrato guardado (números até ontem) — NÃO consulta a Meta.
  const readSnapshot = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/analysis/video-map");
      const d = (await res.json()) as { error?: string; snapshot?: Snapshot | null; bank?: string[] };
      if (d.error) throw new Error(d.error);
      const snap = d.snapshot ?? null;
      setBank(d.bank ?? []);
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

  const videos = useMemo(() => (data ? summarizeVideos(data.accounts, bank) : []), [data, bank]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: videos.length };
    for (const v of videos) for (const t of v.tags) c[t] = (c[t] ?? 0) + 1;
    return c;
  }, [videos]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return videos.filter((v) => (filter === "todos" || v.tags.includes(filter)) && (!needle || v.label.toLowerCase().includes(needle)));
  }, [videos, filter, q]);

  const contas = useMemo(() => (data ? summarizeAccounts(data.accounts, bank) : []), [data, bank]);
  const selectedConta = useMemo(() => contas.find((a) => a.accountId === contaSel) ?? null, [contas, contaSel]);
  // Sem conta escolhida: os números são de CONTAS (quantas contas têm vídeo naquela situação). Com conta escolhida: são de VÍDEOS dessa conta.
  const contaCounts = useMemo(() => {
    if (selectedConta) return { todos: selectedConta.items.length, ...selectedConta.counts } as Record<string, number>;
    const c: Record<string, number> = { todos: contas.length };
    for (const a of contas) for (const t of Object.keys(a.counts) as AccountVideoTag[]) if (a.counts[t] > 0) c[t] = (c[t] ?? 0) + 1;
    return c;
  }, [contas, selectedConta]);
  const contasShown = useMemo(() => contas.filter((a) => filterConta === "todos" || a.counts[filterConta] > 0), [contas, filterConta]);

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
        {focus ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {data?.computedFor ? `Até ontem (${untilTxt(data.computedFor)})${snapshotAt ? ` · calculado ${atTxt(snapshotAt)}` : ""}` : ""}
          </p>
        ) : (
        <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Vídeos de Geral</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {focus ? "Vídeos do banco nessa conta." : mode === "conta" ? (selectedConta ? `Vídeos do banco em ${selectedConta.clientName} (meta ${fmtCurrency(selectedConta.cpaTarget)}).` : "Cada conta com Meta CPA e a situação dos vídeos do banco nela.") : "Cada vídeo do banco e como ele está em todas as contas."} {focus ? "" : " Só leitura — nada é alterado."}
              {data?.computedFor ? ` Números até ontem (${untilTxt(data.computedFor)}), atualizados de madrugada${snapshotAt ? ` — calculado ${atTxt(snapshotAt)}` : ""}. "Ativo" é a situação no momento do cálculo.` : ""}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {focus ? null : (
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
            {([
              ["conta", "Por conta"],
              ["video", "Por vídeo"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  mode === id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          )}
          {focus ? null : mode === "conta" ? (
            <select
              value={selectedConta ? contaSel : ""}
              onChange={(e) => setContaSel(e.target.value)}
              className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Todas as contas</option>
              {contas.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.clientName}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar vídeo"
              className="h-8 w-48 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
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
        {mode === "video"
          ? FILTERS.map((f) => (
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
            ))
          : CONTA_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterConta(f.id)}
                title={f.id === "todos" ? undefined : CONTA_TAGS[f.id].hint}
                className={`h-7 rounded-full px-2.5 text-xs font-medium ${
                  filterConta === f.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                {selectedConta ? CONTA_VIDEO_LABELS[f.id] : f.label} ({contaCounts[f.id] ?? 0})
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
      ) : mode === "conta" ? (
        selectedConta ? (
          <div className="px-4 py-2">
            <VideosDaConta items={selectedConta.items.filter((i) => filterConta === "todos" || i.tags.includes(filterConta))} lean={focus} />
          </div>
        ) : (
          focus ? (
            <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              Sem dados de vídeos dessa conta no retrato (a conta precisa ter Meta CPA cadastrada). Clique em Atualizar agora.
            </p>
          ) : (
            <PorConta contas={contasShown} filter={filterConta} open={open} toggle={toggle} />
          )
        )
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
                <th className="px-4 py-1.5 text-right font-medium" title="Custo por conversa médio dos últimos 30 dias (até ontem)">CPA médio 30d</th>
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
                    <td className="px-4 py-2 text-right tabular-nums">{cpaTxt(v.cpa30)}</td>
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

      {focus ? null : (
      <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        “Bom” = CPA médio dos últimos 30 dias abaixo da Meta CPA da conta, com {GOOD_MIN_CONV}+ conversas. Só entram anúncios com nome no padrão “GERAL | …”
        (os nomes antigos e os vídeos fora da lista ficam de fora). Limites usados: parado = mais de {RECENT_DAYS} dias; pouco testado = menos de {fmtCurrency(LOW_SPEND_30D)} ou menos de {LOW_CONV_30D} conversas em 30 dias.
        {data && data.errors.length > 0 ? ` Erro em ${data.errors.length} lote(s)/conta(s): ${data.errors[0].slice(0, 100)}` : ""}
      </p>
      )}
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
          <th className="px-3 py-1 text-right font-medium" title="Custo por conversa médio dos últimos 30 dias (até ontem)">CPA médio 30d</th>
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
            <td className="px-3 py-1.5 text-right tabular-nums">{cpaTxt(r.cpa30)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{fmtCurrency(r.cpaTarget)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmtCurrency(r.spend30)}</td>
            <td className="px-3 py-1.5 text-right text-zinc-500 dark:text-zinc-400">{dayTxt(r.daysSinceCreated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PorConta({
  contas,
  filter,
  open,
  toggle,
}: {
  contas: AccountSummary[];
  filter: "todos" | AccountVideoTag;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  if (contas.length === 0) return <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">Nenhuma conta nessa situação.</p>;
  const order: AccountVideoTag[] = ["reativar", "repetido", "nunca", "parado", "pouco", "caro"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-zinc-400">
            <th className="px-4 py-1.5 font-medium">Conta</th>
            <th className="px-4 py-1.5 text-right font-medium">Meta</th>
            <th className="px-4 py-1.5 text-right font-medium">Vídeos ativos</th>
            {order.map((t) => (
              <th key={t} title={CONTA_TAGS[t].hint} className="px-3 py-1.5 text-right font-medium">
                {CONTA_TAGS[t].short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contas.map((a) => {
            const isOpen = open.has(`c:${a.accountId}`);
            const items = a.items.filter((i) => filter === "todos" || i.tags.includes(filter));
            return (
              <Fragment key={a.accountId}>
                <tr onClick={() => toggle(`c:${a.accountId}`)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-2 font-medium">
                    <span className="mr-1 text-xs text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                    {a.clientName}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500">{fmtCurrency(a.cpaTarget)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{a.activeVideos}</td>
                  {order.map((t) => (
                    <td key={t} className="px-3 py-2 text-right tabular-nums">
                      {a.counts[t] > 0 ? <span className={`rounded-full px-2 py-0.5 text-xs ${CONTA_TAGS[t].cls}`}>{a.counts[t]}</span> : <span className="text-zinc-300 dark:text-zinc-600">0</span>}
                    </td>
                  ))}
                </tr>
                {isOpen ? (
                  <tr className="border-t border-zinc-100 dark:border-zinc-800/60">
                    <td colSpan={9} className="bg-zinc-50/60 px-4 py-2 dark:bg-zinc-800/20">
                      <VideosDaConta items={items} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VideosDaConta({ items, lean = false }: { items: AccountSummary["items"]; lean?: boolean }) {
  if (items.length === 0) return <p className="py-2 text-sm text-zinc-500">Nenhum vídeo nessa situação.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
          <th className="px-3 py-1 font-medium">Vídeo</th>
          <th className="px-3 py-1 font-medium">Nesta conta</th>
          <th className="px-3 py-1 font-medium">Situação</th>
          <th className="px-3 py-1 text-right font-medium">CPA 7 dias</th>
          <th className="px-3 py-1 text-right font-medium" title="Custo por conversa médio dos últimos 30 dias (até ontem)">CPA médio 30d</th>
          {lean ? null : <th className="px-3 py-1 text-right font-medium">Gasto 30d</th>}
          {lean ? null : <th className="px-3 py-1 text-right font-medium">Conv. 30d</th>}
          {lean ? null : <th className="px-3 py-1 text-right font-medium">Último anúncio</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.key} className="border-t border-zinc-100 dark:border-zinc-800/60">
            <td className="px-3 py-1.5">{i.label.replace(/^GERAL \| /, "")}</td>
            <td className="px-3 py-1.5">
              {i.state === "ativo" ? (
                <span className={i.activeAdsets >= 2 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                  ativo em {i.activeAdsets} conjunto{i.activeAdsets === 1 ? "" : "s"}
                </span>
              ) : i.state === "pausado" ? (
                <span className="text-zinc-500">pausado</span>
              ) : (
                <span className="text-zinc-400">nunca usado</span>
              )}
            </td>
            <td className="px-3 py-1.5">
              <div className="flex flex-wrap gap-1">
                {i.tags.length === 0 ? <span className="text-xs text-zinc-400">—</span> : null}
                {i.tags.map((t) => (
                  <span key={t} title={CONTA_TAGS[t].hint} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${CONTA_TAGS[t].cls}`}>
                    {CONTA_TAGS[t].label}
                  </span>
                ))}
              </div>
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">{cpaTxt(i.cpa7d)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{cpaTxt(i.cpa30)}</td>
            {lean ? null : <td className="px-3 py-1.5 text-right tabular-nums">{fmtCurrency(i.spend30)}</td>}
            {lean ? null : <td className="px-3 py-1.5 text-right tabular-nums">{i.conv30}</td>}
            {lean ? null : <td className="px-3 py-1.5 text-right text-zinc-500 dark:text-zinc-400">{dayTxt(i.daysSinceCreated)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
