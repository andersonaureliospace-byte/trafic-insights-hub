"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Btn } from "@/components/estrategia/ui";
import { NovoFeedbackPrint } from "@/components/estrategia/novo-feedback-print";
import { matchesResp } from "@/components/estrategia/use-carteira";
import { usePriorityOptions } from "@/lib/priority-context";
import {
  NovaTarefa,
  ProgramarFeedbacks,
  ProximoFeedback,
  TIPO_ICON,
  TIPO_LABEL,
  TarefaModal,
  addDays,
  api,
  fmtDia,
  type ClienteUI,
  type RotinaUI,
  type TarefaUI,
} from "@/components/estrategia/demandas-modais";

// Etapa 286: quadro Demandas — Kanban por dia. A 1ª coluna é sempre Hoje (com as atrasadas no topo), depois Amanhã e
// os próximos dias. Arraste o cartão pra cima/baixo ou pra outro dia. Concluídas vão pro fim da coluna. Rotinas geram as
// tarefas sozinhas; alertas graves do Acompanhamento e feedbacks também viram tarefa.

interface Board {
  hoje: string;
  from: string;
  to: string;
  tarefas: TarefaUI[];
  rotinas: RotinaUI[];
  clientes: ClienteUI[];
  gestores: string[];
  semFeedback: string[];
  semTabela?: boolean;
}

const DIAS_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const weekday = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Quadro() {
  const { ui } = useEstr();
  const { options } = usePriorityOptions();
  const params = useSearchParams();
  const [board, setBoard] = useState<Board | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [offset, setOffset] = useState(0); // em dias, a partir de hoje (semana anterior/próxima)
  const [q, setQ] = useState(params.get("cliente") ?? "");
  const [verFeitas, setVerFeitas] = useState(true);
  const [aberta, setAberta] = useState<TarefaUI | null>(null);
  const [nova, setNova] = useState<{ data?: string } | null>(null);
  // Etapa 300: clicar num cartão de feedback abre a tela de enviar o feedback (print, sem IA ou vídeo)
  const [feedbackDe, setFeedbackDe] = useState<TarefaUI | null>(null);
  const [fbOpen, setFbOpen] = useState(false);
  const [proxFb, setProxFb] = useState<TarefaUI | null>(null);
  const dragId = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ dia: string; idx: number } | null>(null);
  // Etapa 316: selecionar várias tarefas de uma vez (concluir, mover de dia, excluir)
  const [selecionando, setSelecionando] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moverPara, setMoverPara] = useState("");
  const [proxDias, setProxDias] = useState(0);
  const [emMassa, setEmMassa] = useState(false);
  const alternarSel = (id: string) =>
    setSel((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sairSelecao = () => {
    setSelecionando(false);
    setSel(new Set());
  };

  const carregar = useCallback(async (off: number) => {
    try {
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const from = addDays(hoje, off);
      const d = await fetch(`/api/estrategia/demandas?from=${from}&to=${addDays(from, 6)}`, { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setBoard(d as Board);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga do quadro (e ao trocar de semana)
    void carregar(offset);
  }, [carregar, offset]);
  const recarregar = () => void carregar(offset);

  const dias = useMemo(() => (board ? Array.from({ length: 7 }, (_, i) => addDays(board.from, i)) : []), [board]);

  const cliMap = useMemo(() => new Map((board?.clientes ?? []).map((c) => [String(c.id).replace(/^act_/, ""), c])), [board]);
  // tarefas por dia (filtradas): abertas por categoria do cliente e concluídas no fim
  const porDia = useMemo(() => {
    const m = new Map<string, TarefaUI[]>();
    if (!board) return m;
    const t = flat(q).split(/\s+/).filter(Boolean);
    const ok = (x: TarefaUI) =>
      matchesResp(ui.resp, x.responsavel) && (verFeitas || x.status !== "feita") && t.every((w) => flat(`${x.titulo} ${x.client_name ?? ""} ${x.responsavel ?? ""}`).includes(w));
    for (const d of dias) m.set(d, []);
    for (const x of board.tarefas) {
      if (!ok(x)) continue;
      // atrasada (aberta, de antes do 1º dia mostrado) aparece no 1º dia
      const dia = x.status === "aberta" && x.data < dias[0] ? dias[0] : x.data;
      m.get(dia)?.push(x);
    }
    for (const [, list] of m) {
      list.sort((a, b) => {
        if (a.status !== b.status) return a.status === "feita" ? 1 : -1;
        if (a.status === "feita") return (a.done_at ?? "").localeCompare(b.done_at ?? "");
        // Etapa 318: por categoria do cliente — Inauguração, Sensíveis, Críticas, Altas, Médias, Baixas, sem cliente/prioridade
        const cat = (x: TarefaUI) => {
          const c = x.ad_account_id ? cliMap.get(String(x.ad_account_id).replace(/^act_/, "")) : undefined;
          if (!c) return 6;
          if (c.priority === "inauguracao") return 0;
          if (c.sensivel) return 1;
          return ({ critica: 2, alta: 3, media: 4, baixa: 5 } as Record<string, number>)[c.priority ?? ""] ?? 6;
        };
        const atrA = a.data < dias[0] ? 0 : 1; // dentro da categoria, atrasada primeiro
        const atrB = b.data < dias[0] ? 0 : 1;
        return cat(a) - cat(b) || atrA - atrB || a.ordem - b.ordem || a.created_at.localeCompare(b.created_at);
      });
    }
    return m;
  }, [board, dias, q, ui.resp, verFeitas, cliMap]);

  function patchLocal(id: string, patch: Partial<TarefaUI>) {
    setBoard((b) => (b ? { ...b, tarefas: b.tarefas.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : b));
  }

  async function concluir(t: TarefaUI) {
    if (t.status === "aberta" && t.tipo === "feedback") {
      setAberta(null);
      setProxFb(t);
      return;
    }
    const feito = t.status !== "feita";
    patchLocal(t.id, { status: feito ? "feita" : "aberta", done_at: feito ? new Date().toISOString() : null });
    setAberta(null);
    try {
      await api({ action: "concluir", id: t.id, feito });
    } catch (e) {
      setErro((e as Error).message);
      recarregar();
    }
  }

  async function emLote(acao: "concluir" | "mover" | "excluir") {
    if (!board || sel.size === 0) return;
    if (acao === "mover" && !moverPara) return;
    const escolhidas = board.tarefas.filter((t) => sel.has(t.id));
    setEmMassa(true);
    setErro(null);
    try {
      for (const t of escolhidas) {
        if (acao === "concluir") {
          if (t.status === "feita") continue;
          const proxima = t.tipo === "feedback" && proxDias > 0 ? addDays(hoje, proxDias) : undefined;
          await api({ action: "concluir", id: t.id, feito: true, ...(proxima ? { proxima } : {}) });
        } else if (acao === "mover") {
          await api({ action: "mover", id: t.id, data: moverPara, ordem: t.ordem });
        } else {
          await api({ action: "excluir", id: t.id });
        }
      }
      sairSelecao();
    } catch (e) {
      setErro((e as Error).message);
    }
    setEmMassa(false);
    recarregar();
  }

  // ---- arrastar ----
  function onDragOverCol(e: React.DragEvent, dia: string) {
    e.preventDefault();
    const col = e.currentTarget as HTMLElement;
    const cards = [...col.querySelectorAll<HTMLElement>("[data-card='aberta']")];
    let idx = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    if (!dropAt || dropAt.dia !== dia || dropAt.idx !== idx) setDropAt({ dia, idx });
  }
  async function onDrop(dia: string) {
    const id = dragId.current;
    const at = dropAt;
    dragId.current = null;
    setDropAt(null);
    if (!id || !at || !board) return;
    const t = board.tarefas.find((x) => x.id === id);
    if (!t) return;
    const abertas = (porDia.get(dia) ?? []).filter((x) => x.status === "aberta" && x.id !== id);
    const prev = abertas[at.idx - 1];
    const next = abertas[at.idx];
    const ordem = prev && next ? (prev.ordem + next.ordem) / 2 : prev ? prev.ordem + 1 : next ? next.ordem - 1 : 0;
    patchLocal(id, { data: dia, ordem });
    try {
      await api({ action: "mover", id, data: dia, ordem });
    } catch (e) {
      setErro((e as Error).message);
      recarregar();
    }
  }

  const hoje = board?.hoje ?? "";
  const cliById = useMemo(() => new Map((board?.clientes ?? []).map((c) => [c.id, c])), [board]);
  const nomeDia = (d: string) => (d === hoje ? "Hoje" : d === addDays(hoje, 1) ? "Amanhã" : d === addDays(hoje, -1) ? "Ontem" : DIAS_LONGO[weekday(d)]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Demandas" sub="Feedbacks dos clientes, por dia">
        <Btn primary onClick={() => setNova({})}>+ Novo feedback</Btn>
        <Btn onClick={() => setFbOpen(true)}>
          💬 Feedbacks{board?.semFeedback.length ? <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">{board.semFeedback.length} sem data</span> : null}
        </Btn>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 lg:px-6">
        <Btn small onClick={() => setOffset((o) => o - 7)}>← Semana anterior</Btn>
        <Btn small onClick={() => setOffset(0)} disabled={offset === 0}>Hoje</Btn>
        <Btn small onClick={() => setOffset((o) => o + 7)}>Próxima semana →</Btn>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar tarefa, cliente ou gestor…"
          aria-label="Pesquisar tarefa"
          className="h-8 w-64 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]"
        />
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={verFeitas} onChange={(e) => setVerFeitas(e.target.checked)} />
          Mostrar concluídas
        </label>
        <Btn small onClick={() => (selecionando ? sairSelecao() : setSelecionando(true))}>{selecionando ? "Cancelar seleção" : "☑ Selecionar vários"}</Btn>
        {erro ? <span className="text-xs text-red-600">{erro}</span> : null}
      </div>
      {selecionando ? (
        <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600/5 px-3 py-2 text-sm lg:mx-6 dark:bg-blue-500/10">
          <span className="font-medium tabular-nums">{sel.size} {sel.size === 1 ? "selecionada" : "selecionadas"}</span>
          <span className="text-xs text-zinc-500">(clique nos cards)</span>
          <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
          <Btn small primary onClick={() => void emLote("concluir")} disabled={emMassa || sel.size === 0}>✓ Concluir</Btn>
          <label htmlFor="dm-prox" className="text-xs text-zinc-500">próximo feedback</label>
          <select id="dm-prox" value={proxDias} onChange={(e) => setProxDias(Number(e.target.value))} className="h-8 rounded-md border border-zinc-300 bg-white px-1.5 text-xs dark:border-white/10 dark:bg-[#141924]">
            <option value={0}>não programar</option>
            <option value={7}>+7 dias</option>
            <option value={15}>+15 dias</option>
            <option value={30}>+30 dias</option>
          </select>
          <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
          <label htmlFor="dm-mover" className="text-xs text-zinc-500">Mover para</label>
          <input id="dm-mover" type="date" value={moverPara} onChange={(e) => setMoverPara(e.target.value)} className="h-8 rounded-md border border-zinc-300 bg-white px-1.5 text-xs dark:border-white/10 dark:bg-[#141924]" />
          <Btn small onClick={() => void emLote("mover")} disabled={emMassa || sel.size === 0 || !moverPara}>Mover</Btn>
          <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-white/10" />
          <Btn small onClick={() => void emLote("excluir")} disabled={emMassa || sel.size === 0}>🗑 Excluir</Btn>
          {emMassa ? <span className="text-xs text-zinc-500">Aplicando…</span> : null}
        </div>
      ) : null}

      {board?.semTabela ? (
        <div className="m-6 rounded-xl border border-dashed border-amber-400 p-6 text-sm">
          Rode o SQL <code>supabase/migrations/0047_demandas.sql</code> no Supabase pra liberar o quadro de Demandas.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 lg:px-6">
        {board == null && !erro ? <p className="text-sm text-zinc-500">Carregando o quadro…</p> : null}
        {dias.map((d) => {
          const list = porDia.get(d) ?? [];
          const abertas = list.filter((x) => x.status === "aberta");
          const isHoje = d === hoje;
          return (
            <section
              key={d}
              onDragOver={(e) => onDragOverCol(e, d)}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropAt(null);
              }}
              onDrop={() => void onDrop(d)}
              className={`flex w-72 shrink-0 flex-col rounded-xl border ${
                isHoje ? "border-blue-500/50 bg-blue-500/[0.04]" : "border-zinc-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.02]"
              } ${dropAt?.dia === d ? "ring-2 ring-blue-500/40" : ""}`}
            >
              <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-white/10">
                <span className={`text-sm font-semibold ${isHoje ? "text-blue-700 dark:text-blue-300" : ""}`}>{nomeDia(d)}</span>
                <span className="text-xs text-zinc-500">{fmtDia(d)}</span>
                <span className="ml-auto rounded-md bg-zinc-100 px-1.5 text-xs font-semibold tabular-nums dark:bg-white/10">{abertas.length}</span>
                <button onClick={() => setNova({ data: d })} title="Novo feedback nesse dia" aria-label={`Novo feedback em ${fmtDia(d)}`} className="rounded px-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
                  +
                </button>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {list.length === 0 ? <p className="py-6 text-center text-xs text-zinc-400">Nada pra esse dia</p> : null}
                {list.map((t) => {
                  const feita = t.status === "feita";
                  const atrasada = !feita && t.data < hoje;
                  const iAberta = abertas.indexOf(t);
                  return (
                    <div key={t.id}>
                      {dropAt?.dia === d && !feita && dropAt.idx === iAberta ? <div className="mb-2 h-1 rounded bg-blue-500" /> : null}
                      <article
                        data-card={feita ? "feita" : "aberta"}
                        draggable
                        onDragStart={(e) => {
                          dragId.current = t.id;
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                          setDropAt(null);
                        }}
                        onClick={() =>
                          selecionando ? alternarSel(t.id) : t.tipo === "feedback" && t.ad_account_id && !feita ? setFeedbackDe(t) : setAberta(t)
                        }
                        className={`group cursor-pointer rounded-lg border p-2.5 shadow-sm transition-colors ${
                          selecionando && sel.has(t.id)
                            ? "border-blue-500 bg-blue-600/10 ring-2 ring-blue-500/60"
                            : feita
                            ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-white/5 dark:bg-white/[0.02]"
                            : t.tipo === "alerta"
                              ? "border-red-500/40 bg-red-500/[0.06] hover:border-red-500/70"
                              : atrasada
                                ? "border-amber-500/50 bg-white hover:border-amber-500 dark:bg-[#141924]"
                                : "border-zinc-200 bg-white hover:border-blue-400 dark:border-white/10 dark:bg-[#141924]"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selecionando ? sel.has(t.id) : feita}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => (selecionando ? alternarSel(t.id) : void concluir(t))}
                            aria-label={selecionando ? `Selecionar ${t.titulo}` : feita ? `Reabrir ${t.titulo}` : `Concluir ${t.titulo}`}
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm leading-snug font-medium ${feita ? "line-through" : ""}`}>
                              <span className="mr-1" title={TIPO_LABEL[t.tipo]}>{TIPO_ICON[t.tipo]}</span>
                              {t.titulo}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAberta(t);
                                }}
                                title="Editar a tarefa (dia, gestor, excluir…)"
                                aria-label={`Editar ${t.titulo}`}
                                className="float-right rounded px-1 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                              >
                                ✎
                              </button>
                            </div>
                            {t.client_name ? <div className="mt-0.5 truncate text-xs font-semibold text-zinc-600 dark:text-zinc-300">{t.client_name}</div> : null}
                            {t.descricao && !feita ? <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{t.descricao}</div> : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {(() => {
                                const c = t.ad_account_id ? cliById.get(t.ad_account_id.replace(/^act_/, "")) : undefined;
                                const prio = c?.priority ? options.find((o) => o.id === c.priority) : undefined;
                                return (
                                  <>
                                    {prio ? (
                                      <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: prio.color, backgroundColor: `${prio.color}22` }}>
                                        ● {prio.label}
                                      </span>
                                    ) : null}
                                    {c?.sensivel ? (
                                      <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 font-bold text-fuchsia-700 dark:text-fuchsia-300" title="Conta sensível (marcada na ficha do cliente)">
                                        ⚠ Sensível
                                      </span>
                                    ) : null}
                                  </>
                                );
                              })()}
                              {t.responsavel ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-white/10">👤 {t.responsavel}</span> : null}
                              {atrasada ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">atrasada · {fmtDia(t.data)}</span> : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })}
                {dropAt?.dia === d && dropAt.idx === abertas.length ? <div className="h-1 rounded bg-blue-500" /> : null}
              </div>
            </section>
          );
        })}
      </div>

      {aberta && board ? (
        <TarefaModal
          key={aberta.id}
          t={aberta}
          gestores={board.gestores}
          hoje={hoje}
          onClose={() => setAberta(null)}
          onChanged={() => {
            setAberta(null);
            recarregar();
          }}
          onConcluir={(t) => void concluir(t)}
        />
      ) : null}
      {feedbackDe?.ad_account_id ? (
        <NovoFeedbackPrint
          clienteId={feedbackDe.ad_account_id}
          enviarAqui
          onClose={() => {
            setFeedbackDe(null);
            recarregar();
          }}
          onCreated={() => {
            setFeedbackDe(null);
            recarregar();
          }}
        />
      ) : null}
      {nova && board ? (
        <NovaTarefa
          clientes={board.clientes}
          gestores={board.gestores}
          hoje={hoje}
          inicial={{ data: nova.data }}
          onClose={() => setNova(null)}
          onSaved={() => {
            setNova(null);
            recarregar();
          }}
        />
      ) : null}
      {fbOpen && board ? (
        <ProgramarFeedbacks
          clientes={board.clientes}
          semFeedback={board.semFeedback}
          hoje={hoje}
          onClose={() => setFbOpen(false)}
          onSaved={() => {
            setFbOpen(false);
            recarregar();
          }}
        />
      ) : null}
      {proxFb ? (
        <ProximoFeedback
          t={proxFb}
          hoje={hoje}
          onClose={() => setProxFb(null)}
          onDone={() => {
            setProxFb(null);
            recarregar();
          }}
        />
      ) : null}
    </div>
  );
}

export default function DemandasPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Carregando…</p>}>
      <Quadro />
    </Suspense>
  );
}
