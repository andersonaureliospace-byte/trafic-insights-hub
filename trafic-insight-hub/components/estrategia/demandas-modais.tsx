"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { Btn } from "./ui";

// Etapa 286: janelas do quadro Demandas — a tarefa (o que fazer, Gerenciador, mensagem), nova tarefa, rotinas,
// programar feedbacks e o "próximo feedback" ao concluir.

export interface TarefaUI {
  id: string;
  titulo: string;
  descricao: string;
  tipo: "manual" | "rotina" | "alerta" | "feedback";
  ad_account_id: string | null;
  client_name: string | null;
  responsavel: string | null;
  data: string;
  ordem: number;
  status: "aberta" | "feita" | "excluida";
  done_at: string | null;
  rotina_id: string | null;
  created_at: string;
}
export interface RotinaUI {
  id: string;
  titulo: string;
  descricao: string;
  alvo: "todos" | "cliente" | "nenhum";
  ad_account_id: string | null;
  responsavel: string | null;
  frequencia: "diaria" | "semanal" | "mensal";
  dias_semana: number[];
  dia_mes: number;
  ativa: boolean;
}
export interface ClienteUI {
  id: string;
  name: string;
  responsible: string | null;
  priority?: string | null;
  sensivel?: boolean;
}

export const TIPO_ICON: Record<TarefaUI["tipo"], string> = { manual: "✎", rotina: "🔁", alerta: "🚨", feedback: "💬" };
export const TIPO_LABEL: Record<TarefaUI["tipo"], string> = { manual: "Tarefa", rotina: "Rotina", alerta: "Alerta do Tráfego", feedback: "Feedback" };
const PRIO_LABEL: Record<string, string> = { inauguracao: "Inauguração", critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const input = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const area = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-white/10 dark:bg-[#141924]";
const lbl = "text-[11px] font-semibold tracking-wide text-zinc-500 uppercase";
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const fmtDia = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
};

export async function api<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/estrategia/demandas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(txt);
  } catch {
    throw new Error(`O servidor respondeu um erro (${r.status}).`);
  }
  if (d.error) throw new Error(String(d.error));
  return d as T;
}

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <div
        className={`flex max-h-[94vh] w-full ${wide ? "max-w-3xl" : "max-w-xl"} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">{footer}</div> : null}
      </div>
    </div>
  );
}

// Escolha de clientes (um ou vários, com "todos").
function EscolherClientes({ clientes, sel, onChange }: { clientes: ClienteUI[]; sel: Set<string>; onChange: (s: Set<string>) => void }) {
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const t = flat(q).split(/\s+/).filter(Boolean);
    return clientes.filter((c) => t.every((x) => flat(`${c.name} ${c.responsible ?? ""}`).includes(x)));
  }, [clientes, q]);
  const todos = clientes.length > 0 && clientes.every((c) => sel.has(c.id));
  return (
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-white/10">
      <div className="mb-2 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar cliente ou gestor…" aria-label="Pesquisar cliente" className={`${input} h-8`} />
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" checked={todos} onChange={(e) => onChange(e.target.checked ? new Set(clientes.map((c) => c.id)) : new Set())} />
          Todos ({clientes.length})
        </label>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {lista.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-white/5">
            <input
              type="checkbox"
              checked={sel.has(c.id)}
              onChange={() => {
                const n = new Set(sel);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                onChange(n);
              }}
            />
            <span className="flex-1 truncate">{c.name}</span>
            {c.sensivel ? <span className="rounded bg-fuchsia-500/20 px-1 text-[10px] font-bold text-fuchsia-700 dark:text-fuchsia-300">⚠ Sensível</span> : null}
            {c.priority ? <span className="text-[11px] font-semibold text-zinc-500">{PRIO_LABEL[c.priority] ?? c.priority}</span> : null}
            <span className="text-xs text-zinc-500">{c.responsible ?? "sem gestor"}</span>
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{sel.size} selecionado{sel.size === 1 ? "" : "s"} · cada tarefa vai pro gestor do cliente</p>
    </div>
  );
}

// ---------- Nova tarefa ----------
export function NovaTarefa({
  clientes,
  gestores,
  hoje,
  inicial,
  onClose,
  onSaved,
}: {
  clientes: ClienteUI[];
  gestores: string[];
  hoje: string;
  inicial?: { contas?: string[]; data?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(inicial?.data ?? hoje);
  const [comCliente, setComCliente] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set(inicial?.contas ?? []));
  const [resp, setResp] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      await api({ action: "criar", titulo, descricao, data, contas: comCliente ? [...sel] : [], responsavel: resp, tipo: feedback ? "feedback" : "manual" });
      onSaved();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(false);
  }
  const pode = titulo.trim() && (!comCliente || sel.size > 0) && !busy;
  return (
    <Modal
      title="+ Nova tarefa"
      onClose={onClose}
      footer={
        <>
          {erro ? <span className="mr-auto text-xs text-red-600">{erro}</span> : null}
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn primary disabled={!pode} onClick={() => void salvar()}>
            {busy ? "Criando…" : comCliente && sel.size > 1 ? `Criar ${sel.size} tarefas` : "Criar tarefa"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label className={lbl} htmlFor="nt-titulo">O que fazer</label>
        <input id="nt-titulo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Subir criativos novos" className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <label className={lbl} htmlFor="nt-desc">Detalhes (opcional)</label>
        <textarea id="nt-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} className={area} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className={lbl} htmlFor="nt-data">Dia</label>
          <input id="nt-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${input} w-44`} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={feedback} onChange={(e) => setFeedback(e.target.checked)} />É um feedback pro cliente
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <span className={lbl}>Pra quem</span>
        <div className="flex gap-2">
          <button className={chip(comCliente)} onClick={() => setComCliente(true)}>Cliente(s)</button>
          <button className={chip(!comCliente)} onClick={() => setComCliente(false)}>Sem cliente</button>
        </div>
        {comCliente ? (
          <EscolherClientes clientes={clientes} sel={sel} onChange={setSel} />
        ) : (
          <select aria-label="Gestor" value={resp} onChange={(e) => setResp(e.target.value)} className={input}>
            <option value="">Eu (sem gestor)</option>
            {gestores.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>
    </Modal>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"}`;

// ---------- Próximo feedback (ao concluir um feedback) ----------
export function ProximoFeedback({ t, hoje, onClose, onDone }: { t: TarefaUI; hoje: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState(addDays(hoje, 7));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function ok(proxima: string | null) {
    setBusy(true);
    try {
      await api({ action: "concluir", id: t.id, feito: true, proxima });
      onDone();
    } catch (e) {
      setErro((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Feedback feito · ${t.client_name ?? ""}`}
      onClose={onClose}
      footer={
        <>
          {erro ? <span className="mr-auto text-xs text-red-600">{erro}</span> : null}
          <Btn onClick={() => void ok(null)} disabled={busy}>Concluir sem programar</Btn>
          <Btn primary onClick={() => void ok(data)} disabled={busy || !data}>{busy ? "Salvando…" : `Programar pra ${fmtDia(data)}`}</Btn>
        </>
      }
    >
      <p className="text-sm">Quando vai ser o próximo feedback desse cliente?</p>
      <div className="flex flex-wrap gap-2">
        {[7, 15, 30].map((n) => (
          <button key={n} className={chip(data === addDays(hoje, n))} onClick={() => setData(addDays(hoje, n))}>
            Daqui {n} dias ({fmtDia(addDays(hoje, n))})
          </button>
        ))}
      </div>
      <input type="date" aria-label="Data do próximo feedback" value={data} onChange={(e) => setData(e.target.value)} className={`${input} w-44`} />
    </Modal>
  );
}

// ---------- A tarefa (o quadro com o que fazer, link e mensagem) ----------
export function TarefaModal({
  t,
  gestores,
  hoje,
  onClose,
  onChanged,
  onConcluir,
}: {
  t: TarefaUI;
  gestores: string[];
  hoje: string;
  onClose: () => void;
  onChanged: () => void;
  onConcluir: (t: TarefaUI) => void;
}) {
  const [titulo, setTitulo] = useState(t.titulo);
  const [descricao, setDescricao] = useState(t.descricao);
  const [data, setData] = useState(t.data);
  const [resp, setResp] = useState(t.responsavel ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // mensagem
  const [destino, setDestino] = useState<"cliente" | "gestor" | "grupo">(t.ad_account_id ? "cliente" : "gestor");
  const [grupoCli, setGrupoCli] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }> | null>(null);
  const [gq, setGq] = useState("");
  const [grupo, setGrupo] = useState<{ id: string; name: string } | null>(null);
  const [texto, setTexto] = useState(`${t.titulo}${t.client_name ? ` — ${t.client_name}` : ""}${t.descricao ? `\n${t.descricao}` : ""}`);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!t.ad_account_id) return;
    fetch(`/api/estrategia/demandas?grupo=${encodeURIComponent(t.ad_account_id)}`)
      .then((r) => r.json())
      .then((d) => setGrupoCli(d.grupo ?? null))
      .catch(() => setGrupoCli(null));
  }, [t.ad_account_id]);

  const mudou = titulo !== t.titulo || descricao !== t.descricao || data !== t.data || resp !== (t.responsavel ?? "");
  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      await api({ action: "atualizar", id: t.id, titulo, descricao, data, responsavel: resp });
      onChanged();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(false);
  }
  async function excluir() {
    setBusy(true);
    try {
      await api({ action: "excluir", id: t.id });
      onChanged();
      onClose();
    } catch (e) {
      setErro((e as Error).message);
      setBusy(false);
    }
  }
  async function enviar() {
    setEnviando(true);
    setErro(null);
    setOk(null);
    try {
      await api({ action: "mensagem", destino, ad_account_id: t.ad_account_id, gestor: resp, groupId: grupo?.id, text: texto });
      setOk("Mensagem enviada ✓");
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviando(false);
  }
  async function carregarGrupos() {
    if (groups) return;
    const d = await fetch("/api/whatsapp/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .catch(() => ({}));
    setGroups((d.groups ?? []) as Array<{ id: string; name: string }>);
  }
  const feita = t.status === "feita";
  const atrasada = t.status === "aberta" && t.data < hoje;
  const shownGroups = (groups ?? []).filter((g) => flat(g.name).includes(flat(gq))).slice(0, 50);
  const podeEnviar =
    texto.trim() && !enviando && (destino === "cliente" ? !!grupoCli : destino === "grupo" ? !!grupo : !!resp);

  return (
    <Modal
      wide
      title={`${TIPO_ICON[t.tipo]} ${TIPO_LABEL[t.tipo]}${t.client_name ? ` · ${t.client_name}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {erro ? <span className="mr-auto text-xs text-red-600">{erro}</span> : ok ? <span className="mr-auto text-xs text-emerald-600">{ok}</span> : null}
          <Btn onClick={() => void excluir()} disabled={busy}>🗑 Excluir</Btn>
          {mudou ? <Btn onClick={() => void salvar()} disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</Btn> : null}
          <Btn primary onClick={() => onConcluir(t)} disabled={busy}>{feita ? "↺ Reabrir" : "✓ Concluir"}</Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {feita ? <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">Concluída</span> : null}
        {atrasada ? <span className="rounded bg-red-500/15 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300">Atrasada desde {fmtDia(t.data)}</span> : null}
        {t.ad_account_id ? (
          <a href={adsManagerUrl(t.ad_account_id)} target="_blank" rel="noopener noreferrer" className="rounded-md border border-zinc-300 px-2 py-1 font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5">
            ↗ Abrir no Gerenciador
          </a>
        ) : null}
        {t.tipo === "feedback" ? (
          <Link href="/estrategia/clientes/feedbacks" className="rounded-md border border-zinc-300 px-2 py-1 font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5">
            💬 Abrir Feedbacks
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className={lbl} htmlFor="tm-titulo">O que fazer</label>
        <input id="tm-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <label className={lbl} htmlFor="tm-desc">Detalhes</label>
        <textarea id="tm-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} className={area} placeholder="Sem detalhes" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={lbl} htmlFor="tm-data">Dia</label>
          <input id="tm-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={lbl} htmlFor="tm-resp">Gestor</label>
          <select id="tm-resp" value={resp} onChange={(e) => setResp(e.target.value)} className={input}>
            <option value="">Sem gestor</option>
            {[...new Set([...(t.responsavel ? [t.responsavel] : []), ...gestores])].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
        <span className={lbl}>Enviar mensagem</span>
        <div className="flex flex-wrap gap-2">
          {t.ad_account_id ? (
            <button className={chip(destino === "cliente")} onClick={() => setDestino("cliente")}>
              👥 Grupo do cliente{grupoCli ? ` (${grupoCli.name})` : grupoCli === null ? " — sem grupo" : ""}
            </button>
          ) : null}
          <button className={chip(destino === "gestor")} onClick={() => setDestino("gestor")}>👤 Gestor{resp ? ` (${resp})` : ""}</button>
          <button
            className={chip(destino === "grupo")}
            onClick={() => {
              setDestino("grupo");
              void carregarGrupos();
            }}
          >
            👥 Outro grupo (ex.: gestores)
          </button>
        </div>
        {destino === "grupo" ? (
          grupo ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">👥 {grupo.name}</span>
              <Btn small onClick={() => setGrupo(null)}>Trocar</Btn>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 p-2 dark:border-white/10">
              <input value={gq} onChange={(e) => setGq(e.target.value)} placeholder="Pesquisar grupo…" aria-label="Pesquisar grupo" className={`${input} mb-2 h-8`} />
              <div className="max-h-36 overflow-y-auto">
                {groups == null ? <p className="px-1 py-2 text-xs text-zinc-500">Carregando grupos…</p> : null}
                {shownGroups.map((g) => (
                  <button key={g.id} onClick={() => setGrupo(g)} className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-white/5">
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : null}
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} aria-label="Mensagem" className={area} />
        <div className="flex justify-end">
          <Btn primary small disabled={!podeEnviar} onClick={() => void enviar()}>{enviando ? "Enviando…" : "📤 Enviar mensagem"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Rotinas ----------
const ROTINA_VAZIA: RotinaUI = { id: "", titulo: "", descricao: "", alvo: "todos", ad_account_id: null, responsavel: null, frequencia: "semanal", dias_semana: [1], dia_mes: 1, ativa: true };

export function descreverRotina(r: RotinaUI, clientes: ClienteUI[]): string {
  const quando =
    r.frequencia === "diaria" ? "todo dia" : r.frequencia === "mensal" ? `todo dia ${r.dia_mes}` : `toda ${r.dias_semana.map((d) => DIAS[d]).join(", ")}`;
  const quem =
    r.alvo === "todos" ? "todos os clientes" : r.alvo === "cliente" ? (clientes.find((c) => c.id === r.ad_account_id)?.name ?? "1 cliente") : (r.responsavel ?? "sem cliente");
  return `${quando} · ${quem}`;
}

export function RotinasModal({
  rotinas,
  clientes,
  gestores,
  onClose,
  onChanged,
}: {
  rotinas: RotinaUI[];
  clientes: ClienteUI[];
  gestores: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [edit, setEdit] = useState<RotinaUI | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(r: RotinaUI) {
    setBusy(true);
    setErro(null);
    try {
      await api({ action: "rotina_salvar", rotina: { ...r, id: r.id || undefined } });
      setEdit(null);
      onChanged();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(false);
  }
  async function excluir(id: string) {
    setBusy(true);
    try {
      await api({ action: "rotina_excluir", id });
      onChanged();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Modal
      wide
      title="🔁 Rotinas de tarefas"
      onClose={onClose}
      footer={
        <>
          {erro ? <span className="mr-auto text-xs text-red-600">{erro}</span> : null}
          {edit ? (
            <>
              <Btn onClick={() => setEdit(null)}>Voltar</Btn>
              <Btn primary disabled={busy || !edit.titulo.trim()} onClick={() => void salvar(edit)}>{busy ? "Salvando…" : "Salvar rotina"}</Btn>
            </>
          ) : (
            <Btn primary onClick={() => setEdit({ ...ROTINA_VAZIA })}>+ Nova rotina</Btn>
          )}
        </>
      }
    >
      {edit ? (
        <>
          <div className="flex flex-col gap-1">
            <label className={lbl} htmlFor="ro-titulo">Tarefa</label>
            <input id="ro-titulo" autoFocus value={edit.titulo} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} placeholder="Ex.: Conferir criativos" className={input} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={lbl} htmlFor="ro-desc">O que fazer (aparece no quadro da tarefa)</label>
            <textarea id="ro-desc" value={edit.descricao} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} rows={3} className={area} />
          </div>
          <div className="flex flex-col gap-2">
            <span className={lbl}>Repete</span>
            <div className="flex flex-wrap gap-2">
              {(["diaria", "semanal", "mensal"] as const).map((f) => (
                <button key={f} className={chip(edit.frequencia === f)} onClick={() => setEdit({ ...edit, frequencia: f })}>
                  {f === "diaria" ? "Todo dia" : f === "semanal" ? "Toda semana" : "Todo mês"}
                </button>
              ))}
            </div>
            {edit.frequencia === "semanal" ? (
              <div className="flex flex-wrap gap-1">
                {DIAS.map((d, i) => (
                  <button
                    key={d}
                    className={chip(edit.dias_semana.includes(i))}
                    onClick={() =>
                      setEdit({ ...edit, dias_semana: edit.dias_semana.includes(i) ? edit.dias_semana.filter((x) => x !== i) : [...edit.dias_semana, i].sort() })
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : null}
            {edit.frequencia === "mensal" ? (
              <label className="flex items-center gap-2 text-sm">
                Dia
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={edit.dia_mes}
                  onChange={(e) => setEdit({ ...edit, dia_mes: Number(e.target.value) || 1 })}
                  className={`${input} w-20`}
                />
                do mês
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className={lbl}>Pra quem</span>
            <div className="flex flex-wrap gap-2">
              <button className={chip(edit.alvo === "todos")} onClick={() => setEdit({ ...edit, alvo: "todos" })}>Todos os clientes (1 tarefa por cliente)</button>
              <button className={chip(edit.alvo === "cliente")} onClick={() => setEdit({ ...edit, alvo: "cliente" })}>Um cliente</button>
              <button className={chip(edit.alvo === "nenhum")} onClick={() => setEdit({ ...edit, alvo: "nenhum" })}>Sem cliente</button>
            </div>
            {edit.alvo === "cliente" ? (
              <select aria-label="Cliente" value={edit.ad_account_id ?? ""} onChange={(e) => setEdit({ ...edit, ad_account_id: e.target.value || null })} className={input}>
                <option value="">Escolha o cliente…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.responsible ? ` (${c.responsible})` : ""}</option>
                ))}
              </select>
            ) : null}
            {edit.alvo === "nenhum" ? (
              <select aria-label="Gestor" value={edit.responsavel ?? ""} onChange={(e) => setEdit({ ...edit, responsavel: e.target.value || null })} className={input}>
                <option value="">Eu (sem gestor)</option>
                {gestores.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            ) : null}
            <p className="text-[11px] text-zinc-500">Com cliente, a tarefa vai sempre pro gestor do cliente.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={edit.ativa} onChange={(e) => setEdit({ ...edit, ativa: e.target.checked })} />
            Ativa
          </label>
        </>
      ) : rotinas.length === 0 ? (
        <p className="rounded-lg bg-zinc-100 px-3 py-6 text-center text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
          Nenhuma rotina ainda. Crie uma (ex.: “Conferir criativos — toda segunda — todos os clientes”) e as tarefas aparecem sozinhas no quadro.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {rotinas.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-semibold ${r.ativa ? "" : "text-zinc-400 line-through"}`}>{r.titulo}</div>
                <div className="truncate text-xs text-zinc-500">{descreverRotina(r, clientes)}</div>
              </div>
              <Btn small onClick={() => setEdit({ ...r })}>Editar</Btn>
              <Btn small onClick={() => void excluir(r.id)} disabled={busy}>Excluir</Btn>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- Programar feedbacks ----------
export function ProgramarFeedbacks({
  clientes,
  semFeedback,
  hoje,
  onClose,
  onSaved,
}: {
  clientes: ClienteUI[];
  semFeedback: string[];
  hoje: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lista = clientes.filter((c) => semFeedback.includes(c.id));
  const [sel, setSel] = useState<Set<string>>(new Set(lista.map((c) => c.id)));
  const [data, setData] = useState(hoje);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      await api({ action: "feedbacks_programar", contas: [...sel], data });
      onSaved();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Modal
      title="💬 Programar feedbacks"
      onClose={onClose}
      footer={
        <>
          {erro ? <span className="mr-auto text-xs text-red-600">{erro}</span> : null}
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn primary disabled={busy || sel.size === 0} onClick={() => void salvar()}>{busy ? "Criando…" : `Programar ${sel.size}`}</Btn>
        </>
      }
    >
      {lista.length === 0 ? (
        <p className="text-sm">Todos os clientes já têm o próximo feedback programado. 👍</p>
      ) : (
        <>
          <p className="text-sm">Esses clientes ainda não têm feedback programado. Escolha o dia — depois, ao concluir cada feedback, você já programa o próximo.</p>
          <input type="date" aria-label="Dia dos feedbacks" value={data} onChange={(e) => setData(e.target.value)} className={`${input} w-44`} />
          <EscolherClientes clientes={lista} sel={sel} onChange={setSel} />
        </>
      )}
    </Modal>
  );
}
