"use client";

import { useEffect, useMemo, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { FocoDescricao } from "@/components/foco/foco-descricao";
import {
  CPA_PERIODS,
  calendarSP,
  closedDaysIn,
  cpaOf,
  cpaSortKey,
  cpaTone,
  ritmoOf,
  ritmoTone,
  investimentoBaixo,
  type CpaPeriod,
} from "@/lib/estrategia/calc";
import type { ActivityItem } from "@/lib/estrategia/activities";
import { useEstr } from "./shell";
import { Card, Pill, ago, fmtBRL, fmtCpa } from "./ui";
import type { Linha } from "./use-carteira";
import { AvisarGestores } from "./avisar-gestores";
import { FichaCliente, pendenciasFicha } from "./ficha-cliente";

// Etapa 238/243: Tráfego → Acompanhamento. Uma linha por conta, sem rolagem lateral:
// conta · responsável · prioridade · investimento no período · orçamento diário (em dia / atrasado / adiantado) · leads · CPA · otimização · ações.
// A coluna Ofertas saiu do quadro (não está sendo usada); os emojis viraram texto ou ícone simples.



const OPT_STALE_DAYS = 3;

function PinIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76V6h6v4.76a2 2 0 0 0 .59 1.42L17 13.6V16H7v-2.4l1.41-1.42A2 2 0 0 0 9 10.76Z" />
      <path d="M8 3h8" />
    </svg>
  );
}

// Etapa 341: Ritmo = orçamento diário ligado agora + se a conta está atrasada/adiantada com a verba até ontem (faixa de R$ 10).
// O orçamento só fica vermelho quando está abaixo de 60% do ritmo médio (verba ÷ dias do mês).
function ritmoTexto(gap: number): string {
  if (Math.abs(gap) < 10) return "em dia";
  return gap > 0 ? `${fmtBRL(gap)} atrasado` : `${fmtBRL(-gap)} adiantado`;
}
const PIN_KEY = "estr_pin";
const PRIO_KEY = "estr_prio_filtro";

export function Otimizacao({ acts, failed, now }: { acts: ActivityItem[] | undefined; failed: boolean; now: number }) {
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
// Etapa 296: o botão "Ficha" abre a ficha do cliente num painel lateral à direita (como em Clientes), com a descrição do Asana
// embaixo. O quadro continua visível e clicável; clicar em "Ficha" de outra linha troca o cliente do painel.
function FichaLateral({ l, onClose, onSaved }: { l: Linha; onClose: () => void; onSaved?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      role="dialog"
      aria-label={`Ficha de ${l.name}`}
      className="fixed top-12 right-0 bottom-0 z-40 flex w-full max-w-[24rem] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#10141c]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-3 dark:border-white/10">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{l.name}</div>
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Ficha do cliente</div>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="text-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <FichaCliente key={l.id} id={l.id} titulo={false} descricao={false} onSaved={onSaved} onArchived={() => { onSaved?.(); onClose(); }} />
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-white/10">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Descrição no Asana</div>
          <div className="h-72 overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10">
            <FocoDescricao key={l.id} accountId={l.id} />
          </div>
        </div>
      </div>
    </aside>
  );
}

export function Acompanhamento({
  linhas,
  activities,
  activitiesFailed,
  pagamento,
  onClienteSalvo,
  soSensiveis = false,
  onSoSensiveis,
  nSensiveis = 0,
  dataAt = null,
}: {
  linhas: Linha[];
  activities: Record<string, ActivityItem[]> | null;
  activitiesFailed: string[];
  // Etapa 284: contas com erro de pagamento ou sem saldo → linha vermelha (id da conta → motivo)
  pagamento?: Record<string, string>;
  // Etapa 296: depois de salvar a ficha, recarrega o quadro
  onClienteSalvo?: () => void;
  // Filtro "Só sensíveis" (substituiu a aba "Sensíveis e críticas")
  soSensiveis?: boolean;
  onSoSensiveis?: (v: boolean) => void;
  nSensiveis?: number;
  // Quando os números da carteira foram buscados na Meta (o cache do navegador pode ser de outro dia).
  dataAt?: number | null;
}) {
  const { ui, setUi, role } = useEstr();
  const isGestor = role === "gestor"; // Etapa 352: gestor — sem ficha, sem "Avisar gestores", sem coluna Responsável
  const { options } = usePriorityOptions();
  const [desc, setDesc] = useState<{ l: Linha } | null>(null);
  // Etapa 248: pesquisa (nome, responsável, grupo do WhatsApp, ID) e conta fixada (as outras ficam com os números embaçados).
  const [q, setQ] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  // Etapa 272: contas marcadas pro "Avisar gestores"
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [avisar, setAvisar] = useState(false);
  // Etapa 340: filtro por prioridade ("" = todas, "__none" = sem prioridade), lembrado neste navegador
  const [prioFiltro, setPrioFiltro] = useState("");
  // tipo de pagamento de cada conta (pra saber se a ficha tem pendência)
  const [pay, setPay] = useState<Record<string, string | null> | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filtro lembrado neste navegador
      setPrioFiltro(localStorage.getItem(PRIO_KEY) ?? "");
    } catch {
      /* sem armazenamento */
    }
  }, []);
  const carregarPay = () =>
    fetch("/api/pix-accounts", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const m: Record<string, string | null> = {};
        for (const r of (d.pixAccounts ?? []) as Array<{ ad_account_id: string; payment_type: string | null }>) m[r.ad_account_id.replace(/^act_/, "")] = r.payment_type;
        setPay(m);
      })
      .catch(() => {});
  useEffect(() => {
    if (!isGestor) void carregarPay();
  }, [isGestor]);
  function trocarPrio(v: string) {
    setPrioFiltro(v);
    try {
      localStorage.setItem(PRIO_KEY, v);
    } catch {
      /* só nesta sessão */
    }
  }
  const marcar = (id: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
  // Ritmo (atrasado/adiantado) usa o dia em que os números foram buscados — senão, com o cache de ontem, comparava a meta
  // até hoje com o gasto só até anteontem e a conta aparecia "atrasada" a mais (um dia inteiro de gasto).
  const calDados = useMemo(() => (dataAt ? calendarSP(new Date(dataAt)) : cal), [dataAt, cal]);
  // Etapa 306: período personalizado (duas datas). As datas ficam lembradas neste navegador.
  const custom = ui.period === "custom";
  const addD = (ymd: string, k: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
  };
  const minDia = addD(cal.today, -(Math.min(62, cal.day + 31) - 1)); // o que a busca da carteira traz
  const [de, setDe] = useState(() => addD(cal.today, -3));
  const [ate, setAte] = useState(() => addD(cal.today, -1));
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem("estr_periodo_custom") ?? "null") as { de?: string; ate?: string } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- datas lembradas neste navegador
      if (v?.de) setDe(v.de);
      if (v?.ate) setAte(v.ate);
    } catch {
      /* sem armazenamento */
    }
  }, []);
  const guardarDatas = (d: string, a: string) => {
    try {
      window.localStorage.setItem("estr_periodo_custom", JSON.stringify({ de: d, ate: a }));
    } catch {
      /* só nesta sessão */
    }
  };
  const [ini, fim] = de <= ate ? [de, ate] : [ate, de];
  const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  const periodLabel = custom ? `de ${fmtDia(ini)} a ${fmtDia(fim)}` : (CPA_PERIODS.find((p) => p.id === period)?.label ?? period).toLowerCase();

  const rows = useMemo(() => {
    const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const terms = flat(q).split(/\s+/).filter(Boolean);
    const porPrio = prioFiltro ? linhas.filter((l) => (prioFiltro === "__none" ? !l.priority : l.priority === prioFiltro)) : linhas;
    const found = terms.length
      ? porPrio.filter((l) => {
          const hay = flat(`${l.name} ${l.responsible ?? ""} ${l.waGroup ?? ""} ${l.id}`);
          return terms.every((t) => hay.includes(t));
        })
      : porPrio;
    const list = found.map((l) => {
      const r = ritmoOf(l.monthly, l.nums?.untilYesterday ?? 0, calDados);
      const sum = custom
        ? l.daily
          ? l.daily.filter((p) => p.date >= ini && p.date <= fim).reduce((a, p) => ({ spend: a.spend + p.spend, results: a.results + p.results }), { spend: 0, results: 0 })
          : null
        : (l.nums?.periods?.[period] ?? null);
      return { l, r, spend: sum?.spend ?? null, leads: sum ? sum.results : null, cpa: sum ? cpaOf(sum) : null };
    });
    const by = ui.sort;
    const rank: Record<string, number> = { inauguracao: 0, critica: 1, alta: 2, media: 3, baixa: 4 };
    list.sort((a, b) => {
      if (by === "nome") return a.l.name.localeCompare(b.l.name, "pt-BR");
      if (by === "responsavel") {
        // Sem responsável vai pro fim; dentro do mesmo responsável, por nome da conta.
        const ra = a.l.responsible ?? "\uffff";
        const rb = b.l.responsible ?? "\uffff";
        return ra.localeCompare(rb, "pt-BR") || a.l.name.localeCompare(b.l.name, "pt-BR");
      }
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
  }, [linhas, period, custom, ini, fim, ui.sort, cal, calDados, activities, q, pinned, prioFiltro]);
  const nPrio = (id: string) => linhas.filter((l) => (id === "__none" ? !l.priority : l.priority === id)).length;
  const pinnedVisible = !!pinned && linhas.some((l) => l.id === pinned);

  const clip = closedDaysIn(period, cal);
  // Com o filtro num gestor só, a coluna Responsável repetiria o mesmo nome em todas as linhas: some.
  const showResp = !isGestor && (!ui.resp || ui.resp === "__none");
  const selectCls = "h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]";
  const th = "px-2 py-2.5 font-semibold";

  return (
    <div className={`flex flex-col gap-3 ${desc ? "lg:pr-[24.5rem]" : ""}`}>
      <Card className="overflow-visible">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
          <label htmlFor="estr-period" className="text-xs text-zinc-500">Período</label>
          <select id="estr-period" value={custom ? "custom" : period} onChange={(e) => setUi({ period: e.target.value })} className={selectCls}>
            {CPA_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
          {custom ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <label htmlFor="estr-de" className="text-xs text-zinc-500">De</label>
              <input
                id="estr-de"
                type="date"
                value={de}
                min={minDia}
                max={cal.today}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setDe(e.target.value);
                  guardarDatas(e.target.value, ate);
                }}
                className={selectCls}
              />
              <label htmlFor="estr-ate" className="text-xs text-zinc-500">até</label>
              <input
                id="estr-ate"
                type="date"
                value={ate}
                min={minDia}
                max={cal.today}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setAte(e.target.value);
                  guardarDatas(de, e.target.value);
                }}
                className={selectCls}
              />
              {ini < minDia ? <span className="text-xs text-amber-600 dark:text-amber-400">Só dá até {fmtDia(minDia)} pra trás</span> : null}
              {linhas.length > 0 && linhas.every((l) => !l.daily) ? <span className="text-xs text-amber-600 dark:text-amber-400">Clique em Atualizar pra usar o personalizado</span> : null}
            </span>
          ) : null}
          {!custom && clip.got < clip.wanted ? (
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
            <option value="responsavel">Responsável</option>
          </select>
          <label htmlFor="estr-prio" className="text-xs text-zinc-500">Prioridade</label>
          <select
            id="estr-prio"
            value={prioFiltro}
            onChange={(e) => trocarPrio(e.target.value)}
            className={`${selectCls} ${prioFiltro ? "border-blue-500 ring-1 ring-blue-500/40" : ""}`}
          >
            <option value="">Todas ({linhas.length})</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({nPrio(o.id)})
              </option>
            ))}
            <option value="__none">Sem prioridade ({nPrio("__none")})</option>
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
          {onSoSensiveis ? (
            <button
              onClick={() => onSoSensiveis(!soSensiveis)}
              aria-pressed={soSensiveis}
              title="Contas marcadas como sensíveis na ficha do cliente"
              className={`h-8 rounded-lg border px-3 text-xs font-medium ${
                soSensiveis ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
              }`}
            >
              Só sensíveis · {nSensiveis}
            </button>
          ) : null}
          {pinnedVisible ? (
            <button
              onClick={() => togglePin(pinned as string)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600/10 px-2 text-xs font-medium text-blue-700 dark:text-blue-300"
              title="Tirar a conta fixada (volta a mostrar os números de todas)"
            >
              <PinIcon on /> {linhas.find((l) => l.id === pinned)?.name} ✕
            </button>
          ) : null}
          <span className="ml-auto text-xs text-zinc-500">{rows.length} contas</span>
        </div>
        {isGestor ? null : (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/70 px-4 py-2 text-xs dark:border-white/10 dark:bg-white/[0.02]">
          <span className={marcadas.size ? "font-semibold text-blue-700 dark:text-blue-300" : "text-zinc-500"}>
            {marcadas.size ? `${marcadas.size} conta${marcadas.size === 1 ? "" : "s"} marcada${marcadas.size === 1 ? "" : "s"}` : "Marque as contas na caixinha para:"}
          </span>
          <button
            onClick={() => setAvisar(true)}
            disabled={marcadas.size === 0}
            className="h-7 rounded-md bg-blue-600 px-2.5 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Avisar gestores
          </button>
          {marcadas.size ? (
            <button onClick={() => setMarcadas(new Set())} className="text-zinc-500 hover:underline">limpar</button>
          ) : null}
        </div>
        )}
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className={showResp ? "w-[23%]" : "w-[31%]"} />
            {showResp ? <col className="w-[9%]" /> : null}
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[6%]" />
            <col className="w-[10%]" />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
              <th className="py-2.5 pr-2 pl-4 font-semibold">
                <span className="flex items-center gap-2">
                  {isGestor ? null : <input
                    type="checkbox"
                    aria-label="Marcar todas as contas da lista"
                    title="Marcar todas da lista"
                    checked={rows.length > 0 && rows.every((x) => marcadas.has(x.l.id))}
                    onChange={(e) => setMarcadas(e.target.checked ? new Set(rows.map((x) => x.l.id)) : new Set())}
                  />}
                  Conta
                </span>
              </th>
              {showResp ? <th className={th}>Responsável</th> : null}
              <th className={th}>Prioridade</th>
              <th className={th} title={`Quanto a conta gastou no período escolhido (${periodLabel}) e, embaixo, quanto já gastou no mês × a verba do mês`}>Investimento</th>
              <th className={th} title="Orçamento diário ligado agora e se a conta está atrasada ou adiantada com a verba até ontem. Vermelho = orçamento abaixo de 60% do ritmo médio">Ritmo</th>
              <th className={`${th} text-right`} title="Leads/conversas no período escolhido">Leads</th>
              <th className={`${th} text-right`}>CPA</th>
              <th className={th} title="Há quanto tempo foi a última otimização do gestor">Otimização</th>
              <th className={`${th} pr-4`}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, r, spend, leads, cpa }, idx) => {
              const prio = options.find((o) => o.id === l.priority);
              // Com uma conta fixada, as outras ficam com os números embaçados (o nome continua legível).
              const blur = pinnedVisible && l.id !== pinned ? "pointer-events-none select-none blur-[4px] opacity-50" : "";
              return (
                <tr
                  key={l.id}
                  className={`border-b border-zinc-100 align-top last:border-0 dark:border-white/5 ${
                    pagamento?.[l.id]
                      ? "bg-red-500/[0.10] shadow-[inset_3px_0_0_0_rgb(239_68_68)] hover:bg-red-500/[0.14]"
                      : pinnedVisible && l.id === pinned
                        ? "bg-blue-600/[0.06]"
                        : idx % 2 === 1
                          ? "bg-zinc-100/70 hover:bg-zinc-200/60 dark:bg-white/[0.045] dark:hover:bg-white/[0.07]"
                          : "hover:bg-zinc-50 dark:hover:bg-white/[0.025]"
                  }`}
                >
                  <td className="py-3 pr-2 pl-4">
                    <div className="flex items-start gap-1">
                    {isGestor ? null : <input
                      type="checkbox"
                      checked={marcadas.has(l.id)}
                      onChange={() => marcar(l.id)}
                      aria-label={`Marcar ${l.name}`}
                      className="mt-1 mr-1 shrink-0"
                    />}
                    <button
                      onClick={() => togglePin(l.id)}
                      title={pinned === l.id ? "Tirar o fixar" : "Fixar esta conta (as outras ficam embaçadas)"}
                      aria-label={pinned === l.id ? `Tirar o fixar de ${l.name}` : `Fixar ${l.name}`}
                      className={`mt-1 shrink-0 transition-opacity ${pinned === l.id ? "text-blue-600 opacity-100 dark:text-blue-400" : "text-zinc-500 opacity-40 hover:opacity-100"}`}
                    >
                      <PinIcon on={pinned === l.id} />
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
                    {pagamento?.[l.id] ? (
                      <span className="mt-1 inline-block max-w-full truncate rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white" title={pagamento[l.id]}>
                        {pagamento[l.id]}
                      </span>
                    ) : null}
                    </div>
                    </div>
                  </td>
                  {showResp ? (
                    <td className="px-2 py-3">
                      {l.responsible ? (
                        <span className="block truncate text-sm font-medium" title={l.responsible}>{l.responsible}</span>
                      ) : (
                        <span className="text-xs text-zinc-400">sem responsável</span>
                      )}
                    </td>
                  ) : null}
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
                  <td className={`px-2 py-3 text-left tabular-nums ${blur}`}>
                    <div>
                      <span className="font-semibold">{spend != null ? fmtBRL(spend) : "—"}</span>
                      <span className="ml-1 text-[11px] text-zinc-500">{periodLabel}</span>
                    </div>
                    {l.monthly && l.nums ? (
                      (() => {
                        const pctMes = Math.min(1, l.nums.monthSpend / l.monthly);
                        return (
                          <div className="mt-1" title={`Gasto no mês (com hoje): ${fmtBRL(l.nums.monthSpend)} de ${fmtBRL(l.monthly)}`}>
                            <div className="text-[11px] text-zinc-500">
                              mês: {fmtBRL(l.nums.monthSpend)} de {fmtBRL(l.monthly)}
                            </div>
                            <div className="mt-0.5 h-1 w-full max-w-[9rem] overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(pctMes * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })()
                    ) : l.monthly ? (
                      <div className="mt-0.5 text-[11px] text-zinc-500">verba do mês {fmtBRL(l.monthly)}</div>
                    ) : null}
                  </td>
                  <td className={`px-2 py-3 tabular-nums ${blur}`}>
                    {(() => {
                      const { baixo, base } = investimentoBaixo(l.dailyBudget, r);
                      const dica = [
                        base != null ? `Ritmo médio: ${fmtBRL(base)}/dia (verba ÷ dias do mês)` : null,
                        baixo ? "Vermelho: orçamento de hoje abaixo de 60% do ritmo médio" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      const tone = ritmoTone(r.gap);
                      return (
                        <div title={dica || undefined}>
                          <div className={`font-semibold ${baixo ? "text-red-600 dark:text-red-400" : ""}`}>
                            {l.dailyBudget === undefined ? "…" : l.dailyBudget == null ? "—" : `${fmtBRL(l.dailyBudget)}/dia`}
                          </div>
                          {r.gap != null ? (
                            <div
                              className={`mt-0.5 text-[11px] font-semibold ${
                                tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"
                              }`}
                            >
                              {ritmoTexto(r.gap)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                  <td className={`px-2 py-3 text-right text-sm font-semibold tabular-nums ${blur}`}>
                    {l.nums && leads != null ? new Intl.NumberFormat("pt-BR").format(Math.round(leads)) : <span className="text-xs font-normal text-zinc-400">—</span>}
                  </td>
                  <td className={`px-2 py-3 text-right ${blur}`}>
                    {l.nums ? (
                      <>
                        <Pill tone={cpa === Infinity ? "bad" : cpaTone(cpa, l.cpaTarget)}>{fmtCpa(cpa)}</Pill>
                        {l.cpaTarget != null ? <div className="mt-0.5 text-[11px] text-zinc-500">ideal {fmtBRL(l.cpaTarget)}</div> : null}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className={`px-2 py-3 ${blur}`}>
                    <Otimizacao
                      acts={activities ? (activities[l.id] ?? (activitiesFailed.includes(l.id) ? undefined : [])) : undefined}
                      failed={activitiesFailed.includes(l.id)}
                      now={now}
                    />
                  </td>
                  <td className="py-3 pr-4 pl-2 text-right whitespace-nowrap">
                    {isGestor ? null : (() => {
                      const falta = pay ? pendenciasFicha(l, pay[l.id] ?? null) : [];
                      const aberto = desc?.l.id === l.id;
                      return (
                        <button
                          onClick={() => setDesc((cur) => (cur?.l.id === l.id ? null : { l }))}
                          title={falta.length ? `Falta preencher: ${falta.join(", ")}` : "Ficha do cliente + descrição do Asana"}
                          aria-label={`Ficha de ${l.name}${falta.length ? " (com pendências)" : ""}`}
                          className={`h-7 rounded-lg border px-2 text-xs font-medium transition-colors ${
                            falta.length
                              ? "border-red-500 bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-300"
                              : aberto
                                ? "border-blue-500 bg-blue-600/10 text-blue-700 dark:text-blue-300"
                                : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
                          } ${aberto ? "ring-2 ring-blue-500/50" : ""}`}
                        >
                          Ficha{falta.length ? ` · ${falta.length}` : ""}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showResp ? 9 : 8} className="px-4 py-10 text-center text-sm text-zinc-500">
                  {q.trim() ? `Nenhuma conta com "${q.trim()}".` : "Nenhuma conta pra esse responsável."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-zinc-200 px-4 py-2.5 text-[11px] text-zinc-500 dark:border-white/10">
          <span><b className="text-zinc-600 dark:text-zinc-300">CPA:</b> <span className="text-emerald-600 dark:text-emerald-400">verde</span> no ideal ou abaixo · <span className="text-amber-600 dark:text-amber-400">laranja</span> até R$ 2 acima · <span className="text-red-600 dark:text-red-400">vermelho</span> mais de R$ 2 acima</span>
          <span><b className="text-zinc-600 dark:text-zinc-300">Investimento:</b> gasto no período escolhido · embaixo, o gasto do mês × a verba</span>
          <span><b className="text-zinc-600 dark:text-zinc-300">Ritmo:</b> orçamento diário ligado agora (sem AQUECIMENTO) · <span className="text-amber-600 dark:text-amber-400">atrasado</span> / <span className="text-blue-600 dark:text-blue-400">adiantado</span> = com a verba até ontem · orçamento <span className="text-red-600 dark:text-red-400">vermelho</span> = abaixo de 60% do ritmo médio (verba ÷ dias do mês)</span>
          <span><b className="text-zinc-600 dark:text-zinc-300">Ficha</b> <span className="text-red-600 dark:text-red-400">vermelha</span> = falta preencher algo</span>
          <span><b className="text-zinc-600 dark:text-zinc-300">Otimização:</b> tempo desde a última mexida do gestor (vermelho = 3 dias ou mais)</span>
          <span><b className="text-zinc-600 dark:text-zinc-300">Linha vermelha:</b> saldo baixo ou erro de pagamento</span>
        </div>
      </Card>


      {avisar ? (
        <AvisarGestores
          linhas={rows.filter((x) => marcadas.has(x.l.id)).map((x) => ({ l: x.l, cpa: x.cpa, spend: x.spend, leads: x.leads }))}
          periodLabel={periodLabel}
          dataAt={dataAt}
          onClose={() => setAvisar(false)}
        />
      ) : null}
      {desc && !isGestor ? (
        <FichaLateral
          l={desc.l}
          onClose={() => setDesc(null)}
          onSaved={() => {
            void carregarPay();
            onClienteSalvo?.();
          }}
        />
      ) : null}
    </div>
  );
}
