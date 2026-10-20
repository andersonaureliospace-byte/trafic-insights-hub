"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import {
  AUDIENCE_DAYS,
  GENDER_LABEL,
  MIN_CONV,
  mergeRows,
  summarizeAudience,
  type AudType,
  type AudienceSummary,
  type Cell,
} from "@/lib/meta/audience-summary";
import type { AudienceAccount } from "@/lib/meta/audience-snapshot";
import { addDaysYmd } from "@/lib/meta/daily-range";

// Etapa 164: Análise → Melhor público. Pra GERAL e EXAME (tipo pelo nome do conjunto), qual faixa etária e qual gênero têm o melhor desempenho
// (menor custo por conversa) nos últimos 14 dias fechados (até ontem). Por conta, como em Vídeos (Geral). Só leitura.

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
const TYPES: AudType[] = ["GERAL", "EXAME"];

const cpaTxt = (c: Cell) => (c.cpa == null ? "—" : fmtCurrency(c.cpa));
const genderTxt = (g: "female" | "male" | null) => (g ? GENDER_LABEL[g] : "—");
const comboTxt = (c: { age: string; gender: "female" | "male" } | null) => (c ? `${GENDER_LABEL[c.gender]} ${c.age}` : "—");

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

  const read = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/audience");
      const d = (await res.json()) as { error?: string; accounts?: Acc[]; snapshot?: Snapshot | null };
      if (d.error) throw new Error(d.error);
      setAccounts(d.accounts ?? []);
      setSnap(d.snapshot ?? null);
    } catch (e) {
      setError((e as Error).message);
      setAccounts([]);
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
        errs.push((e as Error).message);
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
  const since = until ? addDaysYmd(until, -(AUDIENCE_DAYS - 1)) : null;

  const byId = useMemo(() => new Map(entries.map((e) => [e.accountId, e])), [entries]);
  const selected = sel ? byId.get(sel) ?? null : null;
  const selectedAcc = sel ? accounts?.find((a) => a.accountId === sel) ?? null : null;

  const network = useMemo(() => {
    const rows = mergeRows(entries.map((e) => e.rows));
    return Object.fromEntries(TYPES.map((t) => [t, summarizeAudience(rows, t)])) as Record<AudType, AudienceSummary>;
  }, [entries]);

  const perAccount = useMemo(
    () =>
      (accounts ?? []).map((a) => {
        const e = byId.get(a.accountId);
        return { a, e, sums: e ? (Object.fromEntries(TYPES.map((t) => [t, summarizeAudience(e.rows, t)])) as Record<AudType, AudienceSummary>) : null };
      }),
    [accounts, byId],
  );

  const missing = (accounts?.length ?? 0) - entries.length;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {focus ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {since && until ? `${dmy(since)} a ${dmy(until)}${snap ? ` · calculado ${atTxt(snap.computed_at)}` : ""}` : ""}
          </p>
        ) : (
        <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Melhor público</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {focus ? "Faixa etária e gênero com o menor custo por conversa — GERAL e EXAME." : "Faixa etária e gênero com o menor custo por conversa em GERAL e EXAME (tipo pelo nome do conjunto)."}
              {since && until ? ` Últimos ${AUDIENCE_DAYS} dias fechados (${dmy(since)} a ${dmy(until)}), atualizados de madrugada${snap ? ` — calculado ${atTxt(snap.computed_at)}` : ""}.` : ""}{focus ? "" : " Só leitura."}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
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
      ) : selected && selectedAcc ? (
        <div className={`grid gap-3 ${focus ? "p-3 2xl:grid-cols-2" : "p-4 lg:grid-cols-2"}`}>
          {TYPES.map((t) => (
            <TypeCard key={t} type={t} sum={summarizeAudience(selected.rows, t)} target={selectedAcc.cpaTarget} lean={focus} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {TYPES.map((t) => (
              <TypeCard key={t} type={t} sum={network[t]} target={null} title={`${t === "GERAL" ? "Geral" : "Exame"} — rede toda (somando as contas)`} compact />
            ))}
          </div>
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
                    ["Melhor faixa", "Melhor gênero", "Melhor combinação", "CPA 14d"].map((h, i) => (
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
                      const s = sums?.[t];
                      const none = !s || s.total.spend <= 0;
                      return [
                        <td key={`${t}a`} className="border-l border-zinc-100 px-3 py-2 dark:border-zinc-800/60">{none ? "—" : s.bestAge ?? <span className="text-xs text-zinc-400">poucos dados</span>}</td>,
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
        “Melhor” = menor custo por conversa entre os grupos com pelo menos {MIN_CONV} conversas (amostra menor não conta). Faixas são as da Meta (quem de fato recebeu o anúncio,
        não só a idade configurada no conjunto). Só conjuntos GERAL e EXAME entram — PROMO, boleto/crediário e campanhas [VAGA]/[TRÁFEGO] ficam de fora. Verde = CPA abaixo da meta da conta; vermelho = R$ 4 ou mais acima.
        Clique numa conta da lista para abrir o detalhe dela.
      </p>
      )}
    </div>
  );
}

function TypeCard({ type, sum, target, title, compact, lean = false }: { type: AudType; sum: AudienceSummary; target: number | null; title?: string; compact?: boolean; lean?: boolean }) {
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
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {fmtCurrency(sum.total.spend)} · {sum.total.conv} conversas · CPA <span className={cpaCls(sum.total.cpa, target)}>{cpaTxt(sum.total)}</span>
          {target != null && !lean ? ` (meta ${fmtCurrency(target)})` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Melhor faixa: {sum.bestAge ?? "poucos dados"}</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Melhor gênero: {genderTxt(sum.bestGender)}</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Melhor combinação: {comboTxt(sum.bestCombo)}</span>
      </div>
      {compact ? null : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
              <th className="px-2 py-1 font-medium">Faixa</th>
              <th className="px-2 py-1 text-right font-medium">Mulher</th>
              <th className="px-2 py-1 text-right font-medium">Homem</th>
              <th className="px-2 py-1 text-right font-medium">Total</th>
              {lean ? null : <th className="px-2 py-1 text-right font-medium">% gasto</th>}
            </tr>
          </thead>
          <tbody>
            {sum.ages.map((a) => (
              <tr key={a.age} className="border-t border-zinc-100 dark:border-zinc-800/60">
                <td className={`px-2 py-1.5 font-medium ${sum.bestAge === a.age ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{a.age}{sum.bestAge === a.age ? " ★" : ""}</td>
                {(["female", "male"] as const).map((g) => (
                  <CellView key={g} cell={sum.cells[`${a.age}|${g}`]} target={target} best={sum.bestCombo?.age === a.age && sum.bestCombo.gender === g} />
                ))}
                <CellView cell={a} target={target} best={sum.bestAge === a.age} />
                {lean ? null : <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{a.share.toFixed(0)}%</td>}
              </tr>
            ))}
            <tr className="border-t border-zinc-200 dark:border-zinc-700">
              <td className="px-2 py-1.5 font-medium">Total</td>
              {genders.map(({ g, cell }) => (
                <CellView key={g} cell={cell} target={target} best={sum.bestGender === g} />
              ))}
              <CellView cell={sum.total} target={target} best={false} />
              {lean ? null : <td />}
            </tr>
          </tbody>
        </table>
      )}
    </div>
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
