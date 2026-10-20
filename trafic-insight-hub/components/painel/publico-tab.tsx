"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import {
  AUTO_MIN_CONV,
  GENDER_LABEL,
  MIN_CONV,
  STD_AGES,
  chooseRows,
  mergeRows,
  summarizeAudience,
  type AudType,
  type AudienceSummary,
  type Cell,
  type PeriodMode,
} from "@/lib/meta/audience-summary";
import type { AudienceAccount } from "@/lib/meta/audience-snapshot";
import { addDaysYmd } from "@/lib/meta/daily-range";

// Etapas 164 e 167: Análise → Melhor público. Pra GERAL e EXAME (tipo pelo nome do conjunto): FAIXA ETÁRIA sugerida pelo volume de conversas (faixas seguidas, mínimo 2,
// ideal 3; todas se o volume é parecido) e melhor gênero/combinação pelo menor custo por conversa. Período: automático (14 dias, 30 se tiver pouco dado), 7, 14 ou 30 dias
// fechados (até ontem). Por conta, como em Vídeos (Geral). Só leitura.

interface Acc {
  accountId: string;
  clientName: string;
  cpaTarget: number | null;
}
interface Snapshot {
  computed_at: string;
  accounts: Record<string, AudienceAccount>;
}

const BATCH = 4;
// "Failed to fetch" = o navegador nem chegou no servidor (internet caiu, ou o site estava sendo publicado naquele instante).
const netMsg = (e: unknown) => {
  const m = (e as Error)?.message ?? String(e);
  return /failed to fetch|networkerror|load failed/i.test(m) ? "Sem conexão com o servidor agora (internet ou publicação em andamento). Tente de novo em instantes." : m;
};
const PERIODS: Array<{ id: PeriodMode; label: string }> = [
  { id: "auto", label: "Período automático" },
  { id: "7", label: "7 dias" },
  { id: "14", label: "14 dias" },
  { id: "30", label: "30 dias" },
];
const TYPES: AudType[] = ["GERAL", "EXAME"];

const cpaTxt = (c: Cell) => (c.cpa == null ? "—" : fmtCurrency(c.cpa));
const genderTxt = (g: "female" | "male" | null) => (g ? GENDER_LABEL[g] : "—");
const comboTxt = (c: { age: string; gender: "female" | "male" } | null) => (c ? `${GENDER_LABEL[c.gender]} ${c.age}` : "—");

type Sums = Record<AudType, { sum: AudienceSummary; days: number; widened: boolean; missing: boolean }>;
function sumsOf(e: AudienceAccount, period: PeriodMode): Sums {
  return Object.fromEntries(
    TYPES.map((t) => {
      const c = chooseRows(e, t, period);
      return [t, { sum: summarizeAudience(c.rows, t), days: c.days, widened: c.widened, missing: c.missing }];
    }),
  ) as Sums;
}

function atTxt(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", " às");
}
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

// Cor do CPA frente à meta da conta (verde = abaixo da meta, vermelho = R$ 4+ acima).
function cpaCls(cpa: number | null, target: number | null): string {
  if (cpa == null || target == null) return "";
  if (cpa < target) return "text-emerald-600 dark:text-emerald-400";
  if (cpa >= target + 4) return "text-red-600 dark:text-red-400";
  return "";
}

// `focusAccountId` (modo Foco): fica preso numa conta só (sem seletor) e o Atualizar refaz só ela.
export function PublicoTab({ focusAccountId }: { focusAccountId?: string } = {}) {
  const focus = !!focusAccountId;
  const [accounts, setAccounts] = useState<Acc[] | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [selState, setSel] = useState("");
  const sel = focusAccountId ?? selState;
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodMode>("auto");

  const read = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/audience");
      const d = (await res.json()) as { error?: string; accounts?: Acc[]; snapshot?: Snapshot | null };
      if (d.error) throw new Error(d.error);
      setAccounts(d.accounts ?? []);
      setSnap(d.snapshot ?? null);
    } catch (e) {
      setError(netMsg(e));
      setAccounts((prev) => prev ?? []); // não apaga a lista que já estava na tela — o botão continua valendo
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o retrato guardado ao abrir a subseção
    void read();
  }, [read]);

  const recalc = useCallback(async () => {
    const list = focusAccountId ? (accounts ?? []).filter((a) => a.accountId === focusAccountId) : (accounts ?? []);
    if (list.length === 0) return;
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: list.length });
    const errs: string[] = [];
    for (let i = 0; i < list.length; i += BATCH) {
      try {
        const res = await fetch("/api/analysis/audience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: list.slice(i, i + BATCH).map((a) => a.accountId) }),
        });
        const d = (await res.json()) as { error?: string; errors?: string[] };
        if (d.error) errs.push(d.error);
        errs.push(...(d.errors ?? []));
      } catch (e) {
        errs.push(netMsg(e));
      }
      setProgress({ done: Math.min(i + BATCH, list.length), total: list.length });
    }
    await read();
    setLoading(false);
    setProgress(null);
    if (errs.length > 0) setError(errs[0]);
  }, [accounts, focusAccountId, read]);

  const entries = useMemo(() => Object.values(snap?.accounts ?? {}).filter((a) => !a.error), [snap]);
  const computedFor = useMemo(() => entries.map((e) => e.computedFor).sort()[0] ?? null, [entries]);
  const until = computedFor ? addDaysYmd(computedFor, -1) : null;
  const periodDays = period === "auto" ? 14 : Number(period);
  const since = until ? addDaysYmd(until, -(periodDays - 1)) : null;

  const byId = useMemo(() => new Map(entries.map((e) => [e.accountId, e])), [entries]);
  const selected = sel ? byId.get(sel) ?? null : null;
  const selectedAcc = sel ? accounts?.find((a) => a.accountId === sel) ?? null : null;

  const network = useMemo(() => {
    // Rede toda: a mesma janela pra todas as contas (automático = 14 dias; o volume somado já é grande).
    const mode: PeriodMode = period === "auto" ? "14" : period;
    const rows = mergeRows(entries.map((e) => chooseRows(e, "GERAL", mode).rows));
    return Object.fromEntries(TYPES.map((t) => [t, summarizeAudience(rows, t)])) as Record<AudType, AudienceSummary>;
  }, [entries, period]);
  const networkMissing = period !== "auto" && period !== "14" && entries.some((e) => chooseRows(e, "GERAL", period).missing);

  const perAccount = useMemo(
    () =>
      (accounts ?? []).map((a) => {
        const e = byId.get(a.accountId);
        return { a, e, sums: e ? sumsOf(e, period) : null };
      }),
    [accounts, byId, period],
  );
  const selectedSums = useMemo(() => (selected ? sumsOf(selected, period) : null), [selected, period]);

  const missing = (accounts?.length ?? 0) - entries.length;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {focus ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {until ? `${period === "auto" ? "até" : `${dmy(since ?? until)} a`} ${dmy(until)}${snap ? ` · calculado ${atTxt(snap.computed_at)}` : ""}` : ""}
          </p>
        ) : (
        <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Melhor público</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Faixa etária sugerida pelo volume de conversas e gênero com o menor custo por conversa em GERAL e EXAME (tipo pelo nome do conjunto).
              {until ? ` ${period === "auto" ? "Automático: 14 dias, ou 30 se o tipo teve pouco dado" : `Últimos ${periodDays} dias`}, fechados até ${dmy(until)}, atualizados de madrugada${snap ? ` — calculado ${atTxt(snap.computed_at)}` : ""}.` : ""} Só leitura.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodMode)}
            title={`Automático usa 14 dias e passa pra 30 se o tipo (Geral ou Exame) teve menos de ${AUTO_MIN_CONV} conversas em 14 dias.`}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {focus ? null : (
          <select
            value={selected || selectedAcc ? sel : ""}
            onChange={(e) => setSel(e.target.value)}
            className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Todas as contas</option>
            {(accounts ?? []).map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.clientName}
              </option>
            ))}
          </select>
          )}
          <button
            onClick={() => void recalc()}
            disabled={loading || !accounts || accounts.length === 0}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading && progress ? `Atualizando… ${progress.done}/${progress.total}` : entries.length === 0 ? "Calcular agora" : "↻ Atualizar agora"}
          </button>
        </div>
      </div>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {loading && progress ? (
        <p className="px-4 py-6 text-sm text-zinc-500">
          Calculando na Meta ({progress.done}/{progress.total} contas)… isso demora um pouco.
        </p>
      ) : !accounts ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">Ainda não há retrato guardado. Ele é calculado de madrugada; para ter agora, clique em "Calcular agora".</p>
      ) : focus && !selected ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">Sem retrato dessa conta ainda. Clique em "Atualizar agora".</p>
      ) : selected && selectedAcc && selectedSums ? (
        <div className={`grid gap-3 ${focus ? "p-3 2xl:grid-cols-2" : "p-4 lg:grid-cols-2"}`}>
          {TYPES.map((t) => (
            <TypeCard key={t} type={t} sum={selectedSums[t].sum} days={selectedSums[t].days} widened={selectedSums[t].widened} missing={selectedSums[t].missing} target={selectedAcc.cpaTarget} lean={focus} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {TYPES.map((t) => (
              <TypeCard key={t} type={t} sum={network[t]} days={periodDays} target={null} title={`${t === "GERAL" ? "Geral" : "Exame"} — rede toda (somando as contas)`} compact />
            ))}
          </div>
          {networkMissing ? (
            <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-400">
              Parte das contas ainda tem o retrato antigo (só 14 dias) — clique em "Atualizar agora" para ter {period} dias.
            </p>
          ) : null}
          {missing > 0 ? (
            <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-400">
              {missing} conta{missing === 1 ? "" : "s"} ainda não entrou no retrato. Use "Atualizar agora" para incluir.
            </p>
          ) : null}
          <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-800/60">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-1.5 font-medium">Conta</th>
                  <th className="px-3 py-1.5 text-right font-medium">Meta</th>
                  {TYPES.map((t) => (
                    <th key={t} colSpan={4} className="border-l border-zinc-100 px-3 py-1.5 text-center font-medium dark:border-zinc-800/60">
                      {t === "GERAL" ? "Geral" : "Exame"}
                    </th>
                  ))}
                </tr>
                <tr className="text-xs text-zinc-400">
                  <th />
                  <th />
                  {TYPES.flatMap((t) =>
                    ["Faixa sugerida", "Melhor gênero", "Melhor combinação", "CPA"].map((h, i) => (
                      <th key={`${t}${h}`} className={`px-3 py-1 font-medium ${i === 0 ? "border-l border-zinc-100 dark:border-zinc-800/60" : ""}`}>
                        {h}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {perAccount.map(({ a, sums }) => (
                  <tr key={a.accountId} onClick={() => setSel(a.accountId)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-medium">{a.clientName}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{a.cpaTarget != null ? fmtCurrency(a.cpaTarget) : "—"}</td>
                    {TYPES.flatMap((t) => {
                      const w = sums?.[t];
                      const s = w?.sum;
                      const none = !s || s.total.spend <= 0;
                      return [
                        <td key={`${t}a`} className="border-l border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
                          {none ? "—" : s.ageRange?.label ?? <span className="text-xs text-zinc-400">poucos dados</span>}
                          {!none && w.days !== 14 ? <span className="ml-1 text-xs text-zinc-400">({w.days}d)</span> : null}
                        </td>,
                        <td key={`${t}g`} className="px-3 py-2">{none ? "—" : genderTxt(s.bestGender)}</td>,
                        <td key={`${t}c`} className="px-3 py-2">{none ? "—" : comboTxt(s.bestCombo)}</td>,
                        <td key={`${t}p`} className={`px-3 py-2 tabular-nums ${none ? "" : cpaCls(s.total.cpa, a.cpaTarget)}`}>{none ? "—" : cpaTxt(s.total)}</td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {focus ? null : (
      <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Faixa sugerida = onde estão mais conversas iniciadas (não o custo): sempre faixas seguidas, no mínimo 2 (ideal 3); se todas têm volume parecido, sugere todas, até as zeradas.
        Melhor gênero e combinação = menor custo por conversa entre os grupos com pelo menos {MIN_CONV} conversas (amostra menor não conta). Faixas são as da Meta (quem de fato recebeu o anúncio,
        não só a idade configurada no conjunto). Só conjuntos GERAL e EXAME entram — PROMO, boleto/crediário e campanhas [VAGA]/[TRÁFEGO] ficam de fora. Verde = CPA abaixo da meta da conta; vermelho = R$ 4 ou mais acima.
        Clique numa conta da lista para abrir o detalhe dela.
      </p>
      )}
    </div>
  );
}

const MALE_COLOR = "#5b3fc4";
const FEMALE_COLOR = "#2fcfcf";
const CHART_H = 120;

function TypeCard({
  type,
  sum,
  days,
  widened = false,
  missing = false,
  target,
  title,
  compact,
  lean = false,
}: {
  type: AudType;
  sum: AudienceSummary;
  days: number;
  widened?: boolean;
  missing?: boolean;
  target: number | null;
  title?: string;
  compact?: boolean;
  lean?: boolean;
}) {
  const name = title ?? (type === "GERAL" ? "Geral" : "Exame");
  if (sum.total.spend <= 0) {
    return (
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">{name}</h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Sem gasto em conjuntos {type === "GERAL" ? "GERAL" : "EXAME"} no período.</p>
      </div>
    );
  }
  const genders = (["female", "male"] as const).map((g) => ({ g, cell: sum.genders.find((x) => x.gender === g) }));
  const chip = "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-semibold">{name}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          <span title={widened ? `Poucas conversas em 14 dias (menos de ${AUTO_MIN_CONV}) — usando 30 dias.` : undefined} className={widened ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
            {days} dias{widened ? " (poucos dados em 14)" : ""}
          </span>{" "}
          · {sum.total.conv} conversas{lean ? "" : ` · ${fmtCurrency(sum.total.spend)}`} · CPA{" "}
          <span className={cpaCls(sum.total.cpa, target)}>{cpaTxt(sum.total)}</span>
          {target != null && !lean ? ` (meta ${fmtCurrency(target)})` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <span title="Sugerida pelo volume de conversas iniciadas, em faixas seguidas (mínimo 2, ideal 3)." className={chip}>
          Faixa sugerida: {sum.ageRange?.label ?? "poucos dados"}
        </span>
        <span className={chip}>Melhor gênero: {genderTxt(sum.bestGender)}</span>
        <span className={chip}>Melhor combinação: {comboTxt(sum.bestCombo)}</span>
      </div>
      {missing ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Esse período ainda não foi calculado nesta conta — mostrando 14 dias. Clique em "Atualizar agora".</p> : null}
      {compact ? null : <AgeChart sum={sum} />}
      {compact || lean ? null : (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">Ver tabela detalhada (CPA por faixa e gênero)</summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
              <th className="px-2 py-1 font-medium">Faixa</th>
              <th className="px-2 py-1 text-right font-medium">Mulher</th>
              <th className="px-2 py-1 text-right font-medium">Homem</th>
              <th className="px-2 py-1 text-right font-medium">Total</th>
              {lean ? null : <th className="px-2 py-1 text-right font-medium">% conversas</th>}
            </tr>
          </thead>
          <tbody>
            {sum.ages.map((a) => {
              const inRange = !!sum.ageRange?.ages.includes(a.age);
              return (
              <tr key={a.age} className="border-t border-zinc-100 dark:border-zinc-800/60">
                <td className={`px-2 py-1.5 font-medium ${inRange ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{a.age === "Unknown" ? "Sem idade" : a.age}{inRange ? " ★" : ""}</td>
                {(["female", "male"] as const).map((g) => (
                  <CellView key={g} cell={sum.cells[`${a.age}|${g}`]} target={target} best={sum.bestCombo?.age === a.age && sum.bestCombo.gender === g} />
                ))}
                <VolumeCell cell={a} target={target} best={inRange} />
                {lean ? null : <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{a.convShare.toFixed(0)}%</td>}
              </tr>
              );
            })}
            <tr className="border-t border-zinc-200 dark:border-zinc-700">
              <td className="px-2 py-1.5 font-medium">Total</td>
              {genders.map(({ g, cell }) => (
                <CellView key={g} cell={cell} target={target} best={sum.bestGender === g} />
              ))}
              <VolumeCell cell={sum.total} target={target} best={false} />
              {lean ? null : <td />}
            </tr>
          </tbody>
        </table>
        </details>
      )}
    </div>
  );
}

// Gráfico no estilo do Gerenciador do Facebook: por faixa etária, barras lado a lado de Homens (roxo) e Mulheres (verde-água), em CONVERSAS iniciadas.
// As faixas da sugestão ficam com fundo verde e ★. Passar o mouse numa faixa abre os detalhes (conversas, %, gasto e CPA de cada gênero).
function AgeChart({ sum }: { sum: AudienceSummary }) {
  const [hover, setHover] = useState<string | null>(null);
  const data = STD_AGES.map((age) => ({ age, m: sum.cells[`${age}|male`], f: sum.cells[`${age}|female`] }));
  const max = Math.max(1, ...data.flatMap((d) => [d.m?.conv ?? 0, d.f?.conv ?? 0]));
  const totalConv = sum.total.conv;
  const pct = (n: number) => (totalConv > 0 ? Math.round((n / totalConv) * 100) : 0);
  const legend = [
    { label: "Homens", color: MALE_COLOR, cell: sum.genders.find((g) => g.gender === "male") },
    { label: "Mulheres", color: FEMALE_COLOR, cell: sum.genders.find((g) => g.gender === "female") },
  ];
  return (
    <div className="mt-3">
      <div className="relative" style={{ height: CHART_H + 22 }}>
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: CHART_H }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800" style={{ top: `${(i * 100) / 3}%` }} />
          ))}
        </div>
        <div className="absolute inset-0 grid grid-cols-6">
          {data.map((d, idx) => {
            const inRange = !!sum.ageRange?.ages.includes(d.age);
            return (
              <div
                key={d.age}
                onMouseEnter={() => setHover(d.age)}
                onMouseLeave={() => setHover((h) => (h === d.age ? null : h))}
                className={`relative flex flex-col ${inRange ? "bg-emerald-50 dark:bg-emerald-950/30" : ""} ${hover === d.age ? "bg-zinc-100 dark:bg-zinc-800/60" : ""}`}
              >
                <div className="flex items-end justify-center gap-0.5 px-1" style={{ height: CHART_H }}>
                  {[
                    { c: d.m, color: MALE_COLOR },
                    { c: d.f, color: FEMALE_COLOR },
                  ].map((b, k) => (
                    <div key={k} className="flex w-1/2 max-w-[1.6rem] flex-col items-center justify-end">
                      <span className="h-3.5 text-[10px] leading-[14px] tabular-nums text-zinc-500 dark:text-zinc-400">{b.c && b.c.conv > 0 ? b.c.conv : ""}</span>
                      <div className="w-full rounded-t-sm" style={{ backgroundColor: b.color, height: b.c && b.c.conv > 0 ? Math.max(2, ((b.c.conv / max) * (CHART_H - 16))) : 0 }} />
                    </div>
                  ))}
                </div>
                <div className={`pt-1 text-center text-xs ${inRange ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {d.age}
                  {inRange ? " ★" : ""}
                </div>
                {hover === d.age ? (
                  <div
                    className={`pointer-events-none absolute top-1 z-20 w-48 rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${idx < 3 ? "left-full ml-1" : "right-full mr-1"}`}
                  >
                    <p className="font-semibold">Faixa etária de {d.age}</p>
                    {[
                      { label: "Homens", color: MALE_COLOR, c: d.m },
                      { label: "Mulheres", color: FEMALE_COLOR, c: d.f },
                    ].map((g) => (
                      <div key={g.label} className="mt-1.5">
                        <p className="flex items-center gap-1.5 font-medium">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: g.color }} />
                          {g.label}
                        </p>
                        <p className="pl-4 text-zinc-500 dark:text-zinc-400">
                          {g.c?.conv ?? 0} conversas · {pct(g.c?.conv ?? 0)}%
                        </p>
                        <p className="pl-4 text-zinc-500 dark:text-zinc-400">
                          {g.c && g.c.spend > 0 ? `${fmtCurrency(g.c.spend)} · CPA ${cpaTxt(g.c)}` : "sem gasto"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {legend.map((l) => (
          <div key={l.label}>
            <p className="flex items-center gap-1.5 font-medium">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
              {l.label}
            </p>
            <p className="pl-4 text-zinc-500 dark:text-zinc-400">
              {pct(l.cell?.conv ?? 0)}% · {l.cell?.conv ?? 0} conv
            </p>
            <p className="pl-4 text-zinc-500 dark:text-zinc-400">CPA {l.cell ? cpaTxt(l.cell) : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Coluna Total: o volume de conversas em destaque (é o critério da faixa sugerida); CPA e gasto embaixo.
function VolumeCell({ cell, target, best }: { cell: Cell; target: number | null; best: boolean }) {
  const none = cell.spend <= 0 && cell.conv <= 0;
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${best ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}>
      <div className="font-semibold">{none ? "—" : `${cell.conv} conv`}</div>
      {none ? null : (
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className={cpaCls(cell.cpa, target)}>{cpaTxt(cell)}</span> · {fmtCurrency(cell.spend)}
        </div>
      )}
    </td>
  );
}

function CellView({ cell, target, best }: { cell?: Cell; target: number | null; best: boolean }) {
  if (!cell || (cell.spend <= 0 && cell.conv <= 0)) return <td className="px-2 py-1.5 text-right text-zinc-300 dark:text-zinc-600">—</td>;
  const few = cell.conv < MIN_CONV;
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${best ? "bg-emerald-50 dark:bg-emerald-950/40" : ""} ${few ? "opacity-60" : ""}`}>
      <div className={`font-medium ${few ? "" : cpaCls(cell.cpa, target)}`}>{cpaTxt(cell)}</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {cell.conv} conv · {fmtCurrency(cell.spend)}
      </div>
    </td>
  );
}
