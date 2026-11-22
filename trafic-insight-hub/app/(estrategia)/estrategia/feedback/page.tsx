"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Btn, Card } from "@/components/estrategia/ui";
import { NovoFeedbackPrint } from "@/components/estrategia/novo-feedback-print";
import { matchesResp } from "@/components/estrategia/use-carteira";
import { usePriorityOptions } from "@/lib/priority-context";

// Etapa 340: aba Feedback (antes "Demandas", que era um calendário). Três colunas:
//   Pendentes   → clientes que precisam de feedback agora
//   Enviados    → já receberam o feedback desta vez
//   Programados → têm um feedback com envio agendado
// Regra da semana (segunda a domingo): cliente normal = 1 feedback; cliente sensível ou com prioridade Crítica = 3
// feedbacks (segunda, quarta e sexta — depois de enviar, ele volta pra Pendentes na quarta e na sexta). A meta da semana
// muda sozinha conforme a prioridade/sensível de agora: se o cliente sai de crítico/sensível, volta a contar 1.

interface Cli {
  id: string;
  name: string;
  responsible: string | null;
  priority: string | null;
  sensivel: boolean;
}
interface Board {
  hoje: string;
  segunda: string;
  clientes: Cli[];
  enviados: Array<{ id: string; ad_account_id: string; sent_at: string }>;
  programados: Array<{ id: string; ad_account_id: string; quando: string }>;
}
type Coluna = "pendente" | "enviado" | "programado";

const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const diasDesde = (a: string, b: string) => {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
};
const fmtQuando = (iso: string) => {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${dia} às ${hora}`;
};

// quantos feedbacks o cliente precisa na semana
export const metaSemana = (c: Pick<Cli, "priority" | "sensivel">) => (c.sensivel || c.priority === "critica" ? 3 : 1);
// quantos já deviam ter saído até hoje (3x: seg = 1, qua = 2, sex = 3)
function liberados(meta: number, diaDaSemana: number) {
  if (meta < 3) return meta;
  return diaDaSemana >= 4 ? 3 : diaDaSemana >= 2 ? 2 : 1;
}
const cat = (c: Cli) => {
  if (c.priority === "inauguracao") return 0;
  if (c.sensivel) return 1;
  return ({ critica: 2, alta: 3, media: 4, baixa: 5 } as Record<string, number>)[c.priority ?? ""] ?? 6;
};
const voltaEm = (feitos: number) => (feitos === 1 ? "volta na quarta" : feitos === 2 ? "volta na sexta" : "");

export default function FeedbackPage() {
  const { ui } = useEstr();
  const { options } = usePriorityOptions();
  const [board, setBoard] = useState<Board | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [abrir, setAbrir] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const d = await fetch("/api/estrategia/feedback-board", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setBoard(d as Board);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga do quadro ao abrir
    void carregar();
    const h = () => void carregar();
    window.addEventListener("feedbacks:changed", h);
    return () => window.removeEventListener("feedbacks:changed", h);
  }, [carregar]);

  const diaDaSemana = board ? diasDesde(board.segunda, board.hoje) : 0; // 0 = segunda … 6 = domingo

  const itens = (() => {
    if (!board) return [];
    const enviadosPor = new Map<string, string[]>();
    for (const e of board.enviados) enviadosPor.set(e.ad_account_id, [...(enviadosPor.get(e.ad_account_id) ?? []), e.sent_at]);
    const progPor = new Map<string, { id: string; quando: string }>();
    for (const p of board.programados) {
      const cur = progPor.get(p.ad_account_id);
      if (!cur || p.quando < cur.quando) progPor.set(p.ad_account_id, { id: p.id, quando: p.quando });
    }
    return board.clientes
      .filter((c) => matchesResp(ui.resp, c.responsible))
      .map((c) => {
        const meta = metaSemana(c);
        const envios = (enviadosPor.get(c.id) ?? []).sort();
        const feitos = Math.min(envios.length, meta);
        const prog = progPor.get(c.id) ?? null;
        const coluna: Coluna = prog ? "programado" : envios.length < liberados(meta, diaDaSemana) ? "pendente" : "enviado";
        return { c, meta, feitos, ultimo: envios[envios.length - 1] ?? null, prog, coluna };
      });
  })();

  // contador da semana (sempre com todos os clientes do responsável escolhido, sem a pesquisa)
  const total = itens.reduce((n, x) => n + x.meta, 0);
  const feitos = itens.reduce((n, x) => n + x.feitos, 0);
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  const pendentesHoje = itens.filter((x) => x.coluna === "pendente").length;

  const colunas = (() => {
    const t = flat(q).split(/\s+/).filter(Boolean);
    const vis = itens.filter((x) => t.every((w) => flat(`${x.c.name} ${x.c.responsible ?? ""}`).includes(w)));
    const of = (k: Coluna) => vis.filter((x) => x.coluna === k);
    return {
      pendente: of("pendente").sort((a, b) => cat(a.c) - cat(b.c) || a.c.name.localeCompare(b.c.name, "pt-BR")),
      enviado: of("enviado").sort((a, b) => (b.ultimo ?? "").localeCompare(a.ultimo ?? "")),
      programado: of("programado").sort((a, b) => (a.prog?.quando ?? "").localeCompare(b.prog?.quando ?? "")),
    };
  })();

  async function cancelar(id: string) {
    setCancelando(id);
    try {
      await fetch(`/api/feedbacks/agendar?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setCancelando(null);
  }

  const COLS: Array<{ k: Coluna; titulo: string; vazio: string; cor: string }> = [
    { k: "pendente", titulo: "Pendentes", vazio: "Nenhum feedback pendente 🎉", cor: "text-amber-600 dark:text-amber-400" },
    { k: "enviado", titulo: "Enviados", vazio: "Nenhum feedback enviado ainda nesta semana", cor: "text-emerald-600 dark:text-emerald-400" },
    { k: "programado", titulo: "Programados", vazio: "Nenhum envio programado", cor: "text-blue-600 dark:text-blue-400" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Feedback" sub="Feedbacks dos clientes nesta semana · clique no cliente pra gerar e enviar">
        <Btn onClick={() => void carregar()}>↻ Atualizar</Btn>
      </PageHeader>

      <div className="flex flex-col gap-4 p-4 lg:p-6">
        {/* contador da semana */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Feedbacks da semana</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums">
                {pct}% <span className="text-sm font-medium text-zinc-500">· {feitos} de {total} feitos · faltam {Math.max(0, total - feitos)}</span>
              </div>
            </div>
            <div className="text-right text-xs text-zinc-500">
              <div>
                <b className="text-amber-600 dark:text-amber-400">{pendentesHoje}</b> pendente{pendentesHoje === 1 ? "" : "s"} agora
              </div>
              <div>Sensível ou crítico = 3 por semana (seg, qua e sex) · os outros = 1</div>
            </div>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-blue-600"}`} style={{ width: `${pct}%` }} />
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar cliente ou gestor…"
            aria-label="Pesquisar cliente ou gestor"
            className="h-8 w-64 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]"
          />
          {erro ? <span className="text-xs text-red-600">{erro}</span> : null}
        </div>

        {board == null && !erro ? <p className="text-sm text-zinc-500">Carregando…</p> : null}

        <div className="grid gap-3 md:grid-cols-3">
          {COLS.map((col) => {
            const list = colunas[col.k];
            return (
              <section key={col.k} className="flex min-h-40 flex-col rounded-xl border border-zinc-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.02]">
                <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-white/10">
                  <span className={`text-sm font-semibold ${col.cor}`}>{col.titulo}</span>
                  <span className="ml-auto rounded-md bg-zinc-100 px-1.5 text-xs font-semibold tabular-nums dark:bg-white/10">{list.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 lg:max-h-[calc(100vh-20rem)]">
                  {list.length === 0 && board ? <p className="py-6 text-center text-xs text-zinc-400">{col.vazio}</p> : null}
                  {list.map((x) => {
                    const prio = x.c.priority ? options.find((o) => o.id === x.c.priority) : undefined;
                    const clicavel = col.k !== "programado";
                    return (
                      <article
                        key={x.c.id}
                        onClick={clicavel ? () => setAbrir(x.c.id) : undefined}
                        className={`rounded-lg border p-2.5 shadow-sm transition-colors ${
                          clicavel ? "cursor-pointer hover:border-blue-400" : ""
                        } ${
                          col.k === "pendente"
                            ? "border-amber-500/40 bg-white dark:bg-[#141924]"
                            : col.k === "enviado"
                              ? "border-zinc-200 bg-white opacity-80 dark:border-white/10 dark:bg-[#141924]"
                              : "border-blue-500/40 bg-white dark:bg-[#141924]"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 truncate text-sm font-semibold" title={x.c.name}>{x.c.name}</div>
                          {x.meta > 1 ? (
                            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums dark:bg-white/10" title="Feedbacks feitos nesta semana">
                              {x.feitos}/{x.meta}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {prio ? (
                            <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: prio.color, backgroundColor: `${prio.color}22` }}>
                              ● {prio.label}
                            </span>
                          ) : null}
                          {x.c.sensivel ? (
                            <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 font-bold text-fuchsia-700 dark:text-fuchsia-300" title="Conta sensível (marcada na ficha do cliente)">
                              ⚠ Sensível
                            </span>
                          ) : null}
                          {x.c.responsible ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-white/10">👤 {x.c.responsible}</span> : null}
                        </div>
                        {col.k === "enviado" && x.ultimo ? (
                          <div className="mt-1.5 text-[11px] text-zinc-500">
                            ✓ enviado {fmtQuando(x.ultimo)}
                            {x.feitos < x.meta ? <b className="ml-1 text-amber-600 dark:text-amber-400">· {voltaEm(x.feitos)}</b> : null}
                          </div>
                        ) : null}
                        {col.k === "programado" && x.prog ? (
                          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <span className="font-semibold text-blue-700 dark:text-blue-300">🕒 {fmtQuando(x.prog.quando)}</span>
                            <button
                              onClick={() => void cancelar(x.prog!.id)}
                              disabled={cancelando === x.prog.id}
                              className="ml-auto text-zinc-500 hover:text-red-600 hover:underline disabled:opacity-50"
                            >
                              {cancelando === x.prog.id ? "cancelando…" : "cancelar"}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {abrir ? (
        <NovoFeedbackPrint
          key={abrir}
          clienteId={abrir}
          enviarAqui
          onClose={() => {
            setAbrir(null);
            void carregar();
          }}
          onCreated={() => {
            setAbrir(null);
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}
