"use client";

import { useEffect, useMemo, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { calendarSP } from "@/lib/estrategia/calc";
import type { Linha } from "@/components/estrategia/use-carteira";

// Etapa 310: Acompanhamento → Ontem × hoje. Um card por conta, só números:
//   ontem (do backup, fixo): investimento, custo por conversa, conversas — e prioridade/sensível embaixo
//   hoje até agora (Meta): investimento diário atual, investido, custo por conversa, conversas
// Ordem: da pior pra melhor pelo CPA de ontem + hoje ÷ CPA ideal (gastou sem conversa = topo).
// Usa a mesma carteira do Acompanhamento: o Atualizar de um atualiza o outro.

const brl = (v: number, d = 2) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

// 0 sem gasto · 1 dentro do ideal · 2 acima · 3 = 3x o ideal ou gastou 3x o ideal sem conversa
function nivel(spend: number, res: number, ideal: number | null): 0 | 1 | 2 | 3 {
  if (spend <= 0) return 0;
  if (!ideal) return res > 0 ? 1 : 2;
  if (res === 0) return spend >= ideal * 3 ? 3 : 2;
  const c = spend / res;
  return c >= ideal * 3 ? 3 : c > ideal ? 2 : 1;
}
const COR_CPA = ["text-zinc-500", "text-blue-600 dark:text-blue-300", "text-orange-600 dark:text-orange-300", "text-red-600 dark:text-red-300"];
const BORDA = ["border-zinc-200 dark:border-white/10", "border-zinc-200 dark:border-white/10", "border-orange-400/60 dark:border-orange-400/45", "border-red-500/70 dark:border-red-400/60"];
const RANK = [
  "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-200",
  "bg-orange-500/15 text-orange-700 dark:text-orange-200",
  "bg-red-500/20 text-red-700 dark:text-red-200",
];
const PRIO: Record<string, { label: string; cls: string; dot: string }> = {
  critica: { label: "Crítica", cls: "bg-red-500/15 text-red-700 dark:text-red-200", dot: "bg-red-500" },
  alta: { label: "Alta", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-200", dot: "bg-orange-500" },
  media: { label: "Média", cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-200", dot: "bg-yellow-500" },
  baixa: { label: "Baixa", cls: "bg-green-500/15 text-green-700 dark:text-green-200", dot: "bg-green-500" },
  inauguracao: { label: "Inauguração", cls: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-200", dot: "bg-zinc-400" },
};
// Etapa 311: contas marcadas como vistas somem da tela até o próximo reset (00h e 12h de Brasília) ou o botão Resetar.
// Fica no Supabase (user_ui_prefs "cards_vistos"), igual em qualquer navegador.
function periodoAtual(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}${Number(g("hour")) >= 12 ? "T12" : "T00"}`;
}
async function salvarVistos(periodo: string, ids: string[]) {
  await fetch("/api/estrategia/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "cards_vistos", value: { periodo, ids } }),
  }).catch(() => {});
}

const cpaTxt = (spend: number, res: number) => (spend <= 0 ? "—" : res === 0 ? "sem conversa" : brl(spend / res));

function Num({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`text-[15px] font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

export function CardsContas({ linhas, isSens, loading }: { linhas: Linha[]; isSens: (id: string) => boolean; loading: boolean }) {
  const [busca, setBusca] = useState("");
  const cal = calendarSP();
  const [vistos, setVistos] = useState<{ periodo: string; ids: string[] }>({ periodo: "", ids: [] });
  const [periodo, setPeriodo] = useState(periodoAtual);
  useEffect(() => {
    fetch("/api/estrategia/prefs?key=cards_vistos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = d?.value as { periodo?: string; ids?: string[] } | null;
        if (v?.periodo && Array.isArray(v.ids)) setVistos({ periodo: v.periodo, ids: v.ids });
      })
      .catch(() => {});
    // a tela pode ficar aberta na virada (00h / 12h): confere a cada minuto
    const t = setInterval(() => setPeriodo(periodoAtual()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ocultos = useMemo(() => new Set(vistos.periodo === periodo ? vistos.ids : []), [vistos, periodo]);
  const marcar = (id: string) => {
    const ids = [...ocultos, id];
    setVistos({ periodo, ids });
    void salvarVistos(periodo, ids);
  };
  const resetar = () => {
    setVistos({ periodo, ids: [] });
    void salvarVistos(periodo, []);
  };

  const cards = useMemo(() => {
    const [y, m, d] = cal.today.split("-").map(Number);
    const ontemYmd = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = flat(busca.trim());
    const list = linhas
      .filter((l) => !ocultos.has(l.id))
      .filter((l) => !q || flat(`${l.name} ${l.responsible ?? ""}`).includes(q))
      .map((l) => {
        const pts = l.daily ?? [];
        const o = pts.find((p) => p.date === ontemYmd) ?? { spend: 0, results: 0 };
        const h = pts.find((p) => p.date === cal.today) ?? { spend: 0, results: 0 };
        const ideal = l.cpaTarget && l.cpaTarget > 0 ? l.cpaTarget : null;
        const tS = o.spend + h.spend;
        const tR = o.results + h.results;
        const score = tR > 0 ? tS / tR / (ideal ?? 1000) : tS > 0 ? 99 + tS : -1;
        return { l, o, h, ideal, tS, tR, score, nt: nivel(tS, tR, ideal), semDados: !l.daily };
      });
    return list.sort((a, b) => b.score - a.score);
  }, [linhas, busca, cal.today, ocultos]);

  const semDados = linhas.length > 0 && linhas.every((l) => !l.daily);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-zinc-500">
          Da pior pra melhor (CPA de ontem + hoje ÷ ideal). Ontem vem do backup; hoje e a ordem atualizam ao abrir esta aba ou no Atualizar.
          {loading ? " Atualizando hoje…" : ""}
        </p>
        {ocultos.size > 0 ? (
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            {ocultos.size} {ocultos.size === 1 ? "vista" : "vistas"} (voltam às {periodo.endsWith("T12") ? "00h" : "12h"})
            <button onClick={resetar} className="h-8 rounded-lg border border-zinc-300 px-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5">
              Resetar
            </button>
          </span>
        ) : null}
        <label htmlFor="cc-busca" className="sr-only">Buscar conta</label>
        <input
          id="cc-busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Conta ou gestor"
          className="h-8 w-44 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />CPA 3x o ideal ou gasto sem conversa</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />CPA acima do ideal</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />CPA dentro do ideal</span>
      </div>
      {semDados ? <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Clique em Atualizar pra carregar os cards.</div> : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
        {cards.map(({ l, o, h, ideal, tS, tR, nt }, i) => {
          const pr = l.priority ? PRIO[l.priority] : null;
          return (
            <div key={l.id} className={`flex flex-col gap-3 rounded-xl border bg-white p-3.5 dark:bg-[#121722] ${BORDA[nt]}`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => marcar(l.id)}
                  aria-label={`Marcar ${l.name} como vista`}
                  title="Marcar como vista (sai da tela até o próximo reset: 00h ou 12h)"
                  className="mt-0.5 h-[18px] w-[18px] flex-none cursor-pointer accent-blue-600"
                />
                <span className={`inline-flex h-[22px] min-w-[26px] flex-none items-center justify-center rounded-md text-xs font-bold ${RANK[nt]}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold" title={l.name}>{l.name}</div>
                  <div className="text-xs text-zinc-500">
                    {l.responsible ?? "Sem responsável"} · {ideal ? `CPA ideal ${brl(ideal)}` : "sem CPA ideal"}
                  </div>
                </div>
                <a
                  href={adsManagerUrl(l.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir no Gerenciador de Anúncios"
                  aria-label={`Abrir ${l.name} no Gerenciador de Anúncios`}
                  className="flex-none rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:border-blue-500 hover:text-blue-600 dark:border-white/15 dark:hover:text-blue-300"
                >
                  ↗
                </a>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-2.5 dark:bg-white/[0.03]">
                  <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Ontem</div>
                  <Num label="Investimento" value={brl(o.spend)} />
                  <Num label="Custo por conversa" value={cpaTxt(o.spend, o.results)} cls={`font-bold ${COR_CPA[nivel(o.spend, o.results, ideal)]}`} />
                  <Num label="Conversas iniciadas" value={String(o.results)} />
                  <div className="mt-auto flex flex-col gap-1.5 border-t border-zinc-200 pt-2 dark:border-white/[0.06]">
                    <div className="text-[11px] text-zinc-500">Prioridade</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pr ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${pr.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />
                          {pr.label}
                        </span>
                      ) : (
                        <span className="rounded-md bg-zinc-500/10 px-1.5 py-0.5 text-xs text-zinc-500">Sem prioridade</span>
                      )}
                      {isSens(l.id) ? <span className="rounded-md bg-purple-500/15 px-1.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-200">Sensível</span> : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-blue-500/25 bg-blue-600/[0.06] p-2.5 dark:bg-blue-600/10">
                  <div className="text-[11px] font-semibold tracking-wide text-blue-700 uppercase dark:text-blue-300">Hoje até agora</div>
                  <Num label="Investimento diário atual" value={l.dailyBudget == null ? (l.dailyBudget === undefined ? "…" : "—") : brl(l.dailyBudget, 0)} />
                  <Num label="Investido até agora" value={brl(h.spend)} />
                  <Num label="Custo por conversa" value={cpaTxt(h.spend, h.results)} cls={`font-bold ${COR_CPA[nivel(h.spend, h.results, ideal)]}`} />
                  <Num label="Conversas iniciadas" value={String(h.results)} />
                </div>
              </div>

              <div className="flex justify-between gap-2 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-white/[0.06]">
                <span>Ontem + hoje</span>
                <span className="tabular-nums">
                  CPA <strong className={COR_CPA[nt]}>{cpaTxt(tS, tR)}</strong>
                  {ideal && tR > 0 ? ` · ${(tS / tR / ideal).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x o ideal` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {cards.length === 0 ? <div className="py-8 text-center text-sm text-zinc-500">Nenhuma conta nesse filtro.</div> : null}
    </div>
  );
}
