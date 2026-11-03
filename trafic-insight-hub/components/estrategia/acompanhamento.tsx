"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { FocoDescricao } from "@/components/foco/foco-descricao";
import {
  CPA_PERIODS,
  RITMO_BAND,
  calendarSP,
  closedDaysIn,
  cpaOf,
  cpaSortKey,
  cpaTone,
  ritmoOf,
  ritmoTone,
  type CpaPeriod,
} from "@/lib/estrategia/calc";
import type { OfferKind, OffersSummary, OfferStatus } from "@/lib/offers/rule";
import type { ActivityItem } from "@/lib/estrategia/activities";
import { useEstr } from "./shell";
import { Card, Pill, ago, fmtBRL, fmtCpa, fmtInt } from "./ui";
import type { Linha, OfferFlags } from "./use-carteira";

// Etapa 238/243: Tráfego → Acompanhamento. Uma linha por conta, sem rolagem lateral:
// conta · prioridade (só leitura) · investimento no período (meta embaixo) · ritmo · CPA no período · ofertas · otimização · descrição.

const fmtMeta = (v: number | null) =>
  v == null ? "sem meta" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

const DOT: Record<OfferStatus, string> = { ATIVO: "bg-emerald-500", INATIVO: "bg-amber-500", INEXISTENTE: "bg-zinc-400" };

// GERAL sempre; EXAME e BOLETO só nas contas que anunciam (ficha do cliente); PROMO quando rodou no mês.
function Ofertas({ s, flags }: { s: OffersSummary | null; flags: OfferFlags | null }) {
  const rows: Array<{ kind: OfferKind; label: string; status: OfferStatus | null; extra: string | null }> = [
    { kind: "geral", label: "GERAL", status: s ? s.geral : null, extra: null },
  ];
  if (flags?.exame) rows.push({ kind: "exame", label: "EXAME", status: s ? s.exame.status : null, extra: s?.exame.offer ?? null });
  if (flags?.boleto) rows.push({ kind: "boleto", label: "BOLETO", status: s ? s.boleto : null, extra: null });
  if (s && s.promo.length > 0) {
    const live = s.promo.filter((p) => p.active);
    rows.push({
      kind: "promo",
      label: "PROMO",
      status: live.length > 0 ? "ATIVO" : "INATIVO",
      extra: (live.length > 0 ? live : s.promo).map((p) => p.offer).join(", "),
    });
  }
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 text-xs">
      {rows.map((r) => {
        const cpa = s?.metrics ? cpaOf(s.metrics.last2d[r.kind]) : null;
        const missing = r.status === "INEXISTENTE";
        return (
          <div key={r.kind} className="contents">
            <span className="font-semibold text-zinc-500">{r.label}</span>
            <span className="flex min-w-0 items-center gap-1.5" title={r.extra ?? undefined}>
              {r.status ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[r.status]}`} /> : null}
              {r.status == null ? (
                <span className="text-zinc-400" title="Sem retrato de ofertas pra essa conta">—</span>
              ) : missing ? (
                <span className="font-medium text-red-600 dark:text-red-400">Não rodou</span>
              ) : r.extra ? (
                <span className="truncate font-medium">{r.extra}</span>
              ) : (
                <span className="font-medium">{r.status === "ATIVO" ? "Ativo" : "Inativo"}</span>
              )}
            </span>
            <span className="text-right tabular-nums" title="CPA dos 2 últimos dias (só o mês atual)">
              {cpa != null && !missing ? fmtCpa(cpa) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const OPT_STALE_DAYS = 3;
const PIN_KEY = "estr_pin";

function Otimizacao({ acts, failed, now }: { acts: ActivityItem[] | undefined; failed: boolean; now: number }) {
  if (failed) return <span className="text-xs text-zinc-400">—</span>;
  if (!acts) return <span className="text-xs text-zinc-400">…</span>;
  const last = acts.find((a) => a.relevant);
  if (!last) return <Pill tone="bad" title="Nenhuma otimização relevante nos últimos 7 dias">+7 d</Pill>;
  const days = (now - Date.parse(last.time)) / 86_400_000;
  return (
    <span title={`${last.what}${last.object ? ` — ${last.object}` : ""}${last.actor ? ` (${last.actor})` : ""}`}>
      <Pill tone={days >= OPT_STALE_DAYS ? "bad" : days >= 1 ? "warn" : "ok"}>{ago(last.time).replace(/^há /, "")}</Pill>
    </span>
  );
}

// Balão da descrição (o mesmo quadro do Foco), ao lado do botão.
function DescricaoBalao({ l, anchor, onClose }: { l: Linha; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // o editor do Foco abre uma caixa própria (fixed) fora do balão: não fecha ao clicar nela
      if (ref.current?.contains(t) || (t as HTMLElement).closest?.(".fixed.z-50, [data-desc-btn]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const width = Math.min(420, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const below = anchor.bottom + 6;
  const top = below + 240 > window.innerHeight ? Math.max(8, anchor.top - 246) : below;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Descrição de ${l.name}`}
      style={{ top, left, width }}
      className="fixed z-40 flex h-60 flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-white/15 dark:bg-[#10141c]"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 text-xs dark:border-white/10">
        <span className="font-semibold">{l.name}</span>
        <button onClick={onClose} aria-label="Fechar" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
      </div>
      <div className="min-h-0 flex-1">
        <FocoDescricao accountId={l.id} />
      </div>
    </div>
  );
}

export function Acompanhamento({
  linhas,
  activities,
  activitiesFailed,
}: {
  linhas: Linha[];
  activities: Record<string, ActivityItem[]> | null;
  activitiesFailed: string[];
}) {
  const { ui, setUi } = useEstr();
  const { options } = usePriorityOptions();
  const [desc, setDesc] = useState<{ l: Linha; anchor: DOMRect } | null>(null);
  // Etapa 248: pesquisa (nome, responsável, grupo do WhatsApp, ID) e conta fixada (as outras ficam com os números embaçados).
  const [q, setQ] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- conta fixada guardada neste navegador
      setPinned(localStorage.getItem(PIN_KEY));
    } catch {
      /* sem armazenamento */
    }
  }, []);
  function togglePin(id: string) {
    const next = pinned === id ? null : id;
    setPinned(next);
    try {
      if (next) localStorage.setItem(PIN_KEY, next);
      else localStorage.removeItem(PIN_KEY);
    } catch {
      /* só nesta sessão */
    }
  }
  const [now] = useState(() => Date.now());
  const period = (CPA_PERIODS.some((p) => p.id === ui.period) ? ui.period : "u3") as CpaPeriod;
  const cal = useMemo(() => calendarSP(), []);

  const rows = useMemo(() => {
    const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const terms = flat(q).split(/\s+/).filter(Boolean);
    const found = terms.length
      ? linhas.filter((l) => {
          const hay = flat(`${l.name} ${l.responsible ?? ""} ${l.waGroup ?? ""} ${l.id}`);
          return terms.every((t) => hay.includes(t));
        })
      : linhas;
    const list = found.map((l) => {
      const r = ritmoOf(l.monthly, l.nums?.untilYesterday ?? 0, cal);
      const sum = l.nums?.periods[period] ?? null;
      return { l, r, spend: sum?.spend ?? null, cpa: sum ? cpaOf(sum) : null };
    });
    const by = ui.sort;
    const rank: Record<string, number> = { inauguracao: 0, critica: 1, alta: 2, media: 3, baixa: 4 };
    list.sort((a, b) => {
      if (by === "nome") return a.l.name.localeCompare(b.l.name, "pt-BR");
      if (by === "ritmo") return Math.abs(b.r.gap ?? 0) - Math.abs(a.r.gap ?? 0);
      if (by === "otim") {
        const t = (id: string) => {
          const x = activities?.[id]?.find((e) => e.relevant);
          return x ? Date.parse(x.time) : 0;
        };
        return t(a.l.id) - t(b.l.id);
      }
      if (by === "prioridade") return (rank[a.l.priority ?? ""] ?? 5) - (rank[b.l.priority ?? ""] ?? 5);
      return cpaSortKey(b.cpa, b.l.cpaTarget) - cpaSortKey(a.cpa, a.l.cpaTarget);
    });
    // Conta fixada sempre no topo.
    if (pinned) {
      const i = list.findIndex((x) => x.l.id === pinned);
      if (i > 0) list.unshift(...list.splice(i, 1));
    }
    return list;
  }, [linhas, period, ui.sort, cal, activities, q, pinned]);
  const pinnedVisible = !!pinned && linhas.some((l) => l.id === pinned);

  const clip = closedDaysIn(period, cal);
  const selectCls = "h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]";
  const th = "px-2 py-2.5 font-semibold";

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
          <label htmlFor="estr-period" className="text-xs text-zinc-500">Período</label>
          <select id="estr-period" value={period} onChange={(e) => setUi({ period: e.target.value })} className={selectCls}>
            {CPA_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {clip.got < clip.wanted ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Só o mês atual: {clip.got === 0 ? "nenhum dia fechado ainda" : `${clip.got} dia${clip.got > 1 ? "s" : ""} fechado${clip.got > 1 ? "s" : ""}`}
              {period === "h" || period.endsWith("h") ? " + hoje" : ""}
            </span>
          ) : null}
          <label htmlFor="estr-sort" className="text-xs text-zinc-500">Ordenar</label>
          <select id="estr-sort" value={ui.sort} onChange={(e) => setUi({ sort: e.target.value })} className={selectCls}>
            <option value="cpa">Pior CPA</option>
            <option value="ritmo">Ritmo mais longe da meta</option>
            <option value="otim">Otimização mais antiga</option>
            <option value="prioridade">Prioridade</option>
            <option value="nome">Nome</option>
          </select>
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar conta, responsável ou grupo…"
              aria-label="Pesquisar conta, responsável ou grupo"
              className={`${selectCls} w-64 pr-7`}
            />
            {q ? (
              <button onClick={() => setQ("")} aria-label="Limpar pesquisa" className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-zinc-400">
                ✕
              </button>
            ) : null}
          </div>
          {pinnedVisible ? (
            <button
              onClick={() => togglePin(pinned as string)}
              className="rounded-lg bg-blue-600/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300"
              title="Tirar a conta fixada (volta a mostrar os números de todas)"
            >
              📌 {linhas.find((l) => l.id === pinned)?.name} ✕
            </button>
          ) : null}
          <span className="ml-auto text-xs text-zinc-500">{rows.length} contas</span>
        </div>
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[19%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[25%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
              <th className="py-2.5 pr-2 pl-4 font-semibold">Conta</th>
              <th className={th}>Prioridade</th>
              <th className={`${th} text-right`}>Investimento</th>
              <th className={th} title="Investimento diário atual · quanto falta pra ficar em dia com a meta">Ritmo</th>
              <th className={`${th} text-right`}>CPA</th>
              <th className={th}>Ofertas</th>
              <th className={th} title="Há quanto tempo foi a última otimização relevante">Otimização</th>
              <th className={`${th} pr-4`}>
                <span className="sr-only">Descrição</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, r, spend, cpa }) => {
              const prio = options.find((o) => o.id === l.priority);
              // Com uma conta fixada, as outras ficam com os números embaçados (o nome continua legível).
              const blur = pinnedVisible && l.id !== pinned ? "pointer-events-none select-none blur-[4px] opacity-50" : "";
              return (
                <tr
                  key={l.id}
                  className={`border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.02] ${
                    pinnedVisible && l.id === pinned ? "bg-blue-600/[0.06]" : ""
                  }`}
                >
                  <td className="py-3 pr-2 pl-4">
                    <div className="flex items-start gap-1">
                    <button
                      onClick={() => togglePin(l.id)}
                      title={pinned === l.id ? "Tirar o fixar" : "Fixar esta conta (as outras ficam embaçadas)"}
                      aria-label={pinned === l.id ? `Tirar o fixar de ${l.name}` : `Fixar ${l.name}`}
                      className={`mt-0.5 shrink-0 text-xs transition-opacity ${pinned === l.id ? "opacity-100" : "opacity-30 hover:opacity-100"}`}
                    >
                      📌
                    </button>
                    <div className="min-w-0 flex-1">
                    <a
                      href={adsManagerUrl(l.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                      title={`${l.name} — abrir no Gerenciador`}
                    >
                      {l.name}
                    </a>
                    <div className="truncate text-xs text-zinc-500">{l.responsible ?? "sem responsável"}</div>
                    </div>
                    </div>
                  </td>
                  <td className={`px-2 py-3 ${blur}`}>
                    {prio ? (
                      <span
                        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-xs font-semibold"
                        style={{ color: prio.color, backgroundColor: `${prio.color}1f` }}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: prio.color }} />
                        {prio.label}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className={`px-2 py-3 text-right tabular-nums ${blur}`}>
                    {spend != null ? fmtBRL(spend) : "—"}
                    <div className="text-xs text-zinc-500" title="Meta mensal">{fmtMeta(l.monthly)}</div>
                  </td>
                  <td className={`px-2 py-3 tabular-nums ${blur}`}>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-semibold" title="Investimento diário atual (orçamento do dia de tudo que está ligado)">
                        {l.dailyBudget === undefined ? "…" : l.dailyBudget == null ? "—" : fmtBRL(l.dailyBudget)}
                      </span>
                      {r.gap != null ? (
                        <Pill
                          tone={ritmoTone(r.gap)}
                          title={r.gap >= 0 ? `Faltam ${fmtBRL(r.gap)} pra ficar em dia com a meta até ontem` : `Passou ${fmtBRL(-r.gap)} da meta até ontem`}
                        >
                          {r.gap >= 0 ? "+" : "−"}
                          {fmtInt(Math.abs(r.gap))}
                        </Pill>
                      ) : null}
                    </div>
                    {r.dailyTarget != null ? (
                      <div className="text-xs text-zinc-500" title="Meta diária">{fmtBRL(r.dailyTarget)}</div>
                    ) : null}
                  </td>
                  <td className={`px-2 py-3 text-right ${blur}`}>
                    {l.nums ? <Pill tone={cpa === Infinity ? "bad" : cpaTone(cpa, l.cpaTarget)}>{fmtCpa(cpa)}</Pill> : <span className="text-xs text-zinc-400">—</span>}
                    <div className="mt-0.5 text-xs text-zinc-500 tabular-nums" title="CPA ideal">{l.cpaTarget != null ? fmtBRL(l.cpaTarget) : ""}</div>
                  </td>
                  <td className={`px-2 py-3 ${blur}`}>
                    <Ofertas s={l.offers} flags={l.flags} />
                  </td>
                  <td className={`px-2 py-3 ${blur}`}>
                    <Otimizacao
                      acts={activities ? (activities[l.id] ?? (activitiesFailed.includes(l.id) ? undefined : [])) : undefined}
                      failed={activitiesFailed.includes(l.id)}
                      now={now}
                    />
                  </td>
                  <td className="py-3 pr-4 pl-2 text-right">
                    <button
                      data-desc-btn
                      onClick={(e) => {
                        const anchor = e.currentTarget.getBoundingClientRect();
                        setDesc((cur) => (cur?.l.id === l.id ? null : { l, anchor }));
                      }}
                      title="Descrição do cliente no Asana"
                      aria-label={`Descrição de ${l.name}`}
                      className={`h-7 rounded-lg border px-2 text-xs font-medium transition-colors ${
                        desc?.l.id === l.id
                          ? "border-blue-500 bg-blue-600/10 text-blue-700 dark:text-blue-300"
                          : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
                      }`}
                    >
                      📝
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-500">
                  {q.trim() ? `Nenhuma conta com "${q.trim()}".` : "Nenhuma conta pra esse responsável."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <p className="text-xs leading-relaxed text-zinc-500">
        <b className="text-zinc-700 dark:text-zinc-300">Investimento</b> e <b className="text-zinc-700 dark:text-zinc-300">CPA</b> seguem o período escolhido (só o mês
        atual); embaixo, a meta mensal e o CPA ideal. <b className="text-zinc-700 dark:text-zinc-300">Ritmo</b>: investimento diário atual e quanto falta pra
        ficar em dia com a meta (positivo = abaixo, negativo = passou; menos de R$ {RITMO_BAND} fica verde); embaixo, a meta diária.{" "}
        <b className="text-zinc-700 dark:text-zinc-300">Ofertas</b>: CPA dos 2 últimos dias. <b className="text-zinc-700 dark:text-zinc-300">Otimização</b>: há
        quanto tempo foi a última mudança relevante (orçamento, liga/desliga, conjunto ou anúncio novo, público, criativo ou lance); passe o mouse pra ver o
        que foi.
      </p>

      {desc ? <DescricaoBalao l={desc.l} anchor={desc.anchor} onClose={() => setDesc(null)} /> : null}
    </div>
  );
}
