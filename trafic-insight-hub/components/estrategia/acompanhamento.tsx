"use client";

import { useMemo, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { FocoDescricao } from "@/components/foco/foco-descricao";
import {
  CPA_PERIODS,
  RITMO_BAND,
  calendarSP,
  cpaOf,
  cpaSortKey,
  cpaTone,
  ritmoOf,
  ritmoTone,
  type CpaPeriod,
} from "@/lib/estrategia/calc";
import type { OfferKind, OffersSummary, OfferStatus } from "@/lib/offers/rule";
import { useEstr } from "./shell";
import { Btn, Card, Pill, fmtBRL, fmtCpa, fmtInt } from "./ui";
import type { Linha } from "./use-carteira";

// Etapa 238: Tráfego → Acompanhamento. Uma linha por conta: investimento de hoje e do mês, Ritmo (média por dia + quanto
// falta pra ficar em dia com a meta), CPA no período escolhido e no mês, ofertas (com CPA dos 2 últimos dias), quanto foi
// pra PROMO no mês e a prioridade/descrição do Asana.

const ASANA_SYNCED = new Set(["baixa", "media", "alta", "critica"]);

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">{sub}</div> : null}
    </Card>
  );
}

const DOT: Record<OfferStatus, string> = { ATIVO: "bg-emerald-500", INATIVO: "bg-amber-500", INEXISTENTE: "bg-zinc-400" };

function Ofertas({ s }: { s: OffersSummary | null }) {
  if (!s) return <span className="text-xs text-zinc-400" title="Sem retrato de ofertas pra essa conta (o padrão de nomes é o das contas IVS)">—</span>;
  const promoStatus: OfferStatus = s.promo.length === 0 ? "INEXISTENTE" : s.promo.some((p) => p.active) ? "ATIVO" : "INATIVO";
  const promoName = s.promo.filter((p) => (promoStatus === "ATIVO" ? p.active : true)).map((p) => p.offer).join(", ");
  const rows: Array<{ kind: OfferKind; label: string; status: OfferStatus; extra: string | null }> = [
    { kind: "geral", label: "GERAL", status: s.geral, extra: null },
    { kind: "exame", label: "EXAME", status: s.exame.status, extra: s.exame.offer },
    { kind: "boleto", label: "BOLETO", status: s.boleto, extra: null },
    { kind: "promo", label: "PROMOÇÃO", status: promoStatus, extra: promoName || null },
  ];
  const shown = rows.filter((r) => r.status !== "INEXISTENTE");
  if (shown.length === 0) return <span className="text-xs text-zinc-400">nenhuma oferta no mês</span>;
  return (
    <div className="grid min-w-[17rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 text-xs">
      {shown.map((r) => {
        const m = s.metrics?.last2d[r.kind];
        const cpa = cpaOf(m);
        return (
          <div key={r.kind} className="contents">
            <span className="font-semibold text-zinc-500">{r.label}</span>
            <span className="flex min-w-0 items-center gap-1.5" title={r.extra ?? undefined}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[r.status]}`} />
              <span className="font-medium">{r.status === "ATIVO" ? "Ativo" : "Inativo"}</span>
              {r.extra ? <span className="truncate text-zinc-500">· {r.extra}</span> : null}
            </span>
            <span className="text-right tabular-nums">{s.metrics ? fmtCpa(cpa) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Acompanhamento({
  linhas,
  onPatch,
  toast,
}: {
  linhas: Linha[];
  onPatch: (id: string, patch: Partial<Linha>) => void;
  toast: (msg: string) => void;
}) {
  const { ui, setUi } = useEstr();
  const { options } = usePriorityOptions();
  const [desc, setDesc] = useState<Linha | null>(null);
  const period = (CPA_PERIODS.some((p) => p.id === ui.period) ? ui.period : "u3") as CpaPeriod;
  const periodInfo = CPA_PERIODS.find((p) => p.id === period)!;
  const cal = useMemo(() => calendarSP(), []);

  const rows = useMemo(() => {
    const list = linhas.map((l) => {
      const r = ritmoOf(l.monthly, l.nums?.untilYesterday ?? 0, cal);
      const cpa = l.nums ? cpaOf(l.nums.periods[period]) : null;
      const cpaMes = l.nums ? cpaOf(l.nums.month) : null;
      return { l, r, cpa, cpaMes };
    });
    const by = ui.sort;
    list.sort((a, b) => {
      if (by === "nome") return a.l.name.localeCompare(b.l.name, "pt-BR");
      if (by === "ritmo") return Math.abs(b.r.gap ?? 0) - Math.abs(a.r.gap ?? 0);
      if (by === "prioridade") {
        const rank: Record<string, number> = { inauguracao: 0, critica: 1, alta: 2, media: 3, baixa: 4 };
        return (rank[a.l.priority ?? ""] ?? 5) - (rank[b.l.priority ?? ""] ?? 5);
      }
      return cpaSortKey(b.cpa, b.l.cpaTarget) - cpaSortKey(a.cpa, a.l.cpaTarget);
    });
    return list;
  }, [linhas, period, ui.sort, cal]);

  const kpi = useMemo(() => {
    let hoje = 0, mes = 0, meta = 0, ate = 0, fora = 0, abaixo = 0;
    for (const { l, r, cpa } of rows) {
      hoje += l.nums?.todaySpend ?? 0;
      mes += l.nums?.monthSpend ?? 0;
      ate += l.nums?.untilYesterday ?? 0;
      meta += l.monthly ?? 0;
      if (cpa != null && l.cpaTarget != null && cpa > l.cpaTarget + 2) fora++;
      if (r.gap != null && r.gap >= RITMO_BAND) abaixo++;
    }
    const passed = cal.day - 1;
    return { hoje, mes, meta, ritmo: passed > 0 ? ate / passed : null, metaDia: meta / cal.daysInMonth, fora, abaixo };
  }, [rows, cal]);

  async function changePriority(l: Linha, priority: string) {
    const prev = l.priority;
    onPatch(l.id, { priority });
    try {
      const res = await fetch("/api/account-bindings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: l.rawId, priority }),
      });
      const d = (await res.json()) as { error?: string };
      if (d.error) throw new Error(d.error);
      const label = options.find((o) => o.id === priority)?.label ?? priority;
      if (!ASANA_SYNCED.has(priority)) {
        toast(`${l.name}: prioridade ${label} salva (essa opção não vai pro Asana)`);
        return;
      }
      const s = await fetch("/api/asana/sync-priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ clientName: l.name, priority }] }),
      }).then((r) => r.json());
      if (s.error) throw new Error(s.error);
      const sum = s.summary as { configured?: boolean; updated?: string[]; notFound?: string[]; unchanged?: number } | undefined;
      if (sum && sum.configured === false) toast(`${l.name}: prioridade salva aqui, mas o Asana não está configurado`);
      else if (sum?.notFound?.length) toast(`${l.name}: prioridade salva aqui, mas não achei o cliente no Asana`);
      else toast(`${l.name}: prioridade ${label} atualizada no Asana`);
    } catch (e) {
      onPatch(l.id, { priority: prev });
      toast(`Não deu pra salvar a prioridade: ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Investido hoje" value={fmtBRL(kpi.hoje)} />
        <Kpi
          label="Investido no mês"
          value={fmtBRL(kpi.mes)}
          sub={kpi.meta > 0 ? `de ${fmtBRL(kpi.meta)} (${Math.round((kpi.mes / kpi.meta) * 100)}%)` : undefined}
        />
        <Kpi label="Ritmo da carteira" value={kpi.ritmo != null ? fmtBRL(kpi.ritmo) : "—"} sub={`meta diária ${fmtBRL(kpi.metaDia)}`} />
        <Kpi label={`CPA fora (${periodInfo.short})`} value={`${kpi.fora} de ${rows.length}`} tone={kpi.fora > 0 ? "warn" : undefined} />
        <Kpi label="Investimento abaixo da meta" value={`${kpi.abaixo} de ${rows.length}`} tone={kpi.abaixo > 0 ? "bad" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
          <label htmlFor="estr-period" className="text-xs text-zinc-500">Período do CPA</label>
          <select
            id="estr-period"
            value={period}
            onChange={(e) => setUi({ period: e.target.value })}
            className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
          >
            {CPA_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <label htmlFor="estr-sort" className="text-xs text-zinc-500">Ordenar</label>
          <select
            id="estr-sort"
            value={ui.sort}
            onChange={(e) => setUi({ sort: e.target.value })}
            className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
          >
            <option value="cpa">Pior CPA</option>
            <option value="ritmo">Ritmo mais longe da meta</option>
            <option value="prioridade">Prioridade</option>
            <option value="nome">Nome</option>
          </select>
          <span className="ml-auto text-xs text-zinc-500">{rows.length} contas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                <th className="px-4 py-2.5 font-semibold">Conta</th>
                <th className="px-3 py-2.5 text-right font-semibold">Invest. hoje</th>
                <th className="px-3 py-2.5 text-right font-semibold">Invest. mês / meta</th>
                <th className="px-3 py-2.5 font-semibold">Ritmo</th>
                <th className="px-3 py-2.5 text-right font-semibold">CPA {periodInfo.short}</th>
                <th className="px-3 py-2.5 text-right font-semibold">CPA mensal</th>
                <th className="px-3 py-2.5 font-semibold">Ofertas · CPA últ. 2 dias</th>
                <th className="px-3 py-2.5 text-right font-semibold">Promoção no mês</th>
                <th className="px-3 py-2.5 font-semibold">Asana</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, r, cpa, cpaMes }) => (
                <tr key={l.id} className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <a
                      href={adsManagerUrl(l.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                      title="Abrir no Gerenciador de Anúncios"
                    >
                      {l.name}
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs whitespace-nowrap text-zinc-500">
                      {l.responsible ?? "sem responsável"}
                      {l.priority === "inauguracao" ? <Pill tone="info">Inauguração</Pill> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.nums ? fmtBRL(l.nums.todaySpend) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {l.nums ? fmtBRL(l.nums.monthSpend) : "—"}
                    <div className="text-xs text-zinc-500">{l.monthly ? `de ${fmtBRL(l.monthly)}` : "sem meta"}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                    {l.nums ? (
                      <>
                        <span className="font-semibold">{r.avg != null ? fmtBRL(r.avg) : "—"}</span>{" "}
                        {r.gap != null ? (
                          <Pill
                            tone={ritmoTone(r.gap)}
                            title={
                              r.gap >= 0
                                ? `Faltam ${fmtBRL(r.gap)} pra ficar em dia com a meta até ontem`
                                : `Passou ${fmtBRL(-r.gap)} da meta até ontem`
                            }
                          >
                            {r.gap >= 0 ? "+" : "−"}
                            {fmtInt(Math.abs(r.gap))}
                          </Pill>
                        ) : null}
                        <div className="text-xs text-zinc-500">{r.dailyTarget != null ? `meta diária ${fmtBRL(r.dailyTarget)}` : "sem meta"}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {l.nums ? <Pill tone={cpa === Infinity ? "bad" : cpaTone(cpa, l.cpaTarget)}>{fmtCpa(cpa)}</Pill> : <span className="text-xs text-zinc-400">sem dados</span>}
                    <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">{l.cpaTarget != null ? `ideal ${fmtBRL(l.cpaTarget)}` : "sem CPA ideal"}</div>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {l.nums ? <Pill tone={cpaMes === Infinity ? "bad" : cpaTone(cpaMes, l.cpaTarget)}>{fmtCpa(cpaMes)}</Pill> : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Ofertas s={l.offers} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {l.offers?.metrics ? (l.offers.metrics.promoSpendMonth > 0 ? fmtBRL(l.offers.metrics.promoSpendMonth) : "—") : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label={`Prioridade de ${l.name}`}
                        value={l.priority ?? ""}
                        onChange={(e) => void changePriority(l, e.target.value)}
                        className="h-8 rounded-lg border border-zinc-300 bg-white px-1.5 text-xs dark:border-white/10 dark:bg-[#141924]"
                      >
                        <option value="" disabled>—</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                      <Btn small onClick={() => setDesc(l)} title="Descrição do cliente no Asana">Descrição</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-zinc-500">
                    Nenhuma conta pra esse responsável.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs leading-relaxed text-zinc-500">
        <b className="text-zinc-700 dark:text-zinc-300">Ritmo</b>: média investida por dia no mês (dia 01 até ontem). O número ao lado é quanto falta
        investir pra conta ficar em dia com a meta até ontem (meta ÷ dias do mês × dias que já passaram − investido). Positivo = abaixo da meta;
        negativo = passou da meta; diferença menor que R$ {RITMO_BAND} fica verde. <b className="text-zinc-700 dark:text-zinc-300">CPA</b>: verde no ideal
        ou abaixo, laranja até R$ 2 acima, vermelho mais de R$ 2 acima. <b className="text-zinc-700 dark:text-zinc-300">Ofertas</b>: retrato das 05h20 e
        12h (CPA dos 2 últimos dias fechados).
      </p>

      {desc ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setDesc(null)}>
          <div
            className="flex h-full w-full max-w-lg flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#10141c]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold">{desc.name}</div>
                <div className="text-xs text-zinc-500">Descrição no Asana · enviar substitui a descrição de lá</div>
              </div>
              <Btn onClick={() => setDesc(null)}>Fechar</Btn>
            </div>
            <div className="min-h-[18rem] rounded-xl border border-zinc-200 dark:border-white/10">
              <FocoDescricao accountId={desc.id} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
