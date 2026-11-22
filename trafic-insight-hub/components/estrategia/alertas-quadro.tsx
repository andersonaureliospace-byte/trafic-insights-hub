"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { calendarSP, cpaOf, investimentoBaixo, ritmoOf, type CpaPeriod } from "@/lib/estrategia/calc";
import { CPA_KEYS, cpaCaiu, parseOrigem } from "@/lib/estrategia/alerta-tarefas";
import type { AlertasServer } from "./alertas";
import type { Linha } from "./use-carteira";
import { Card, ago, fmtBRL, fmtCpa } from "./ui";

// Etapa 341: Acompanhamento → Alertas. Só os clientes que precisam de atenção, pra antecipar problemas.
// Cada cliente fica fechado (só o nome); duplo clique abre: um alerta por linha, com as tarefas daquele alerta do lado. As tarefas você narra (ou escreve) e a IA anota.
// Tarefa fecha sozinha quando: CPA de hoje caiu (tarefa de CPA — a automação confere a cada 30 min em horário comercial)
// ou o alerta que ela resolvia sumiu; ou você marca como feita. Feita sai do quadro. Cliente cujas tarefas foram todas
// feitas hoje sai do quadro (fica em "Resolvidos hoje").

export type Sev = "critico" | "alta" | "media";
export interface Alerta {
  key: string;
  titulo: string;
  detalhe: string;
  sev: Sev;
  srv?: boolean; // depende dos dados de saldo/erros/otimização (não só das métricas)
}
interface Tarefa {
  id: string;
  titulo: string;
  descricao: string;
  ad_account_id: string | null;
  client_name: string | null;
  responsavel: string | null;
  status: "aberta" | "feita";
  done_at: string | null;
  origem_key: string | null;
  created_at: string;
}

const SEV_W: Record<Sev, number> = { critico: 9, alta: 4, media: 1 };
const SEV_CLS: Record<Sev, string> = {
  critico: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  alta: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  media: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};
const CPA_ACIMA = 5; // R$ acima do ideal = já entra no alerta
const MUITO_ALTO = 20; // R$ acima do ideal = CPA muito alto (atenção redobrada)
const INV_MES_FAIXA = 100; // R$ de diferença até ontem pra avisar investimento do mês baixo/alto
const SEM_OTIM_H = 48;
const NAO_ERRO = /em an[aá]lise|pending_review|in_process|pr[eé]-?aprovad|preapproved/i;
const norm = (id: string | null | undefined) => String(id ?? "").replace(/^act_/, "");
const addDias = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const fmtDia = (ymd: string | undefined) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : "");
const horaSP = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date())) % 24;

export function alertasDe(l: Linha, srv: AlertasServer | null, cal = calendarSP(), now = Date.now()): Alerta[] {
  const out: Alerta[] = [];
  const alvo = l.cpaTarget;
  const inaug = l.priority === "inauguracao";
  const n = l.nums;

  // CPA acima do ideal (últimos 3 dias, últimos 2 dias, ontem) — inauguração fica de fora
  if (n && alvo != null && !inaug) {
    const fatias: Array<[string, CpaPeriod, string]> = [
      ["cpa_u3", "u3", "últimos 3 dias"],
      ["cpa_u2", "u2", "últimos 2 dias"],
      ["cpa_ontem", "o", "ontem"],
    ];
    for (const [key, p, label] of fatias) {
      const s = n.periods[p];
      const cpa = cpaOf(s);
      if (cpa == null) continue;
      const over = cpa === Infinity ? s.spend - alvo : cpa - alvo;
      if (over <= CPA_ACIMA) continue;
      out.push({
        key,
        titulo: `CPA acima · ${label}`,
        detalhe: cpa === Infinity ? `${fmtBRL(s.spend)} sem lead · ideal ${fmtBRL(alvo)}` : `${fmtCpa(cpa)} · ideal ${fmtBRL(alvo)}`,
        sev: over > MUITO_ALTO ? "critico" : "alta",
      });
    }
    // CPA muito alto: hoje ou últimos 3 dias mais de R$ 20 acima do ideal
    const muito = (["h", "u3"] as CpaPeriod[])
      .map((p) => ({ p, s: n.periods[p], cpa: cpaOf(n.periods[p]) }))
      .find((x) => x.cpa != null && (x.cpa === Infinity ? x.s.spend - alvo : x.cpa - alvo) > MUITO_ALTO);
    if (muito) {
      out.push({
        key: "cpa_muito_alto",
        titulo: "CPA muito alto",
        detalhe: `${muito.p === "h" ? "Hoje" : "Últimos 3 dias"}: ${muito.cpa === Infinity ? `${fmtBRL(muito.s.spend)} sem lead` : fmtCpa(muito.cpa)} · mais de ${fmtBRL(MUITO_ALTO)} acima do ideal`,
        sev: "critico",
      });
    }
    // (extra) gastando hoje sem nenhum lead: 1,5× o CPA ideal já gasto e zero conversa
    const h = n.periods.h;
    if (h.results <= 0 && h.spend >= alvo * 1.5) {
      out.push({ key: "sem_lead_hoje", titulo: "Gastando sem lead hoje", detalhe: `${fmtBRL(h.spend)} gastos hoje e nenhuma conversa`, sev: "alta" });
    }
  }

  // investimento do mês (até ontem) baixo ou alto demais
  const r = ritmoOf(l.monthly, n?.untilYesterday ?? 0, cal);
  if (n && r.gap != null && !inaug) {
    if (r.gap >= INV_MES_FAIXA) out.push({ key: "inv_mensal_baixo", titulo: "Investimento do mês baixo", detalhe: `${fmtBRL(r.gap)} abaixo do ideal até ontem`, sev: r.gap >= 3 * INV_MES_FAIXA ? "alta" : "media" });
    else if (r.gap <= -INV_MES_FAIXA) out.push({ key: "inv_mensal_alto", titulo: "Investimento do mês alto", detalhe: `${fmtBRL(-r.gap)} acima do ideal até ontem`, sev: -r.gap >= 3 * INV_MES_FAIXA ? "alta" : "media" });
  }
  // investimento diário baixo: orçamento de hoje abaixo de 60% do ritmo médio
  const ib = investimentoBaixo(l.dailyBudget, r);
  if (ib.baixo && ib.base != null) {
    out.push({ key: "inv_diario_baixo", titulo: "Investimento diário baixo", detalhe: `Orçamento ${fmtBRL(l.dailyBudget)}/dia · ritmo médio ${fmtBRL(ib.base)}/dia`, sev: "alta" });
  }
  // (extra) não gastou nada hoje (a partir das 11h, com orçamento ligado)
  if (n && n.todaySpend <= 0 && (l.dailyBudget ?? 0) > 0 && horaSP() >= 11) {
    out.push({ key: "sem_gasto_hoje", titulo: "Não gastou nada hoje", detalhe: `Orçamento de ${fmtBRL(l.dailyBudget)}/dia ligado e R$ 0 gasto até agora`, sev: "alta" });
  }

  if (srv) {
    // problema de conta: falha de pagamento, saldo baixo
    const pay = srv.payment.find((p) => norm(p.ad_account_id) === l.id);
    if (pay) out.push({ key: "pagamento", titulo: "Falha de pagamento", detalhe: pay.reason ?? "Erro no pagamento da conta", sev: "critico", srv: true });
    const bal = srv.balance.find((b) => norm(b.ad_account_id) === l.id && b.low && !b.handled);
    if (bal) out.push({ key: "saldo_baixo", titulo: "Saldo baixo", detalhe: `Saldo ${fmtBRL(bal.balance)} · limite ${fmtBRL(bal.threshold)}`, sev: bal.balance <= 0 ? "critico" : "alta", srv: true });
    // erro na conta: reprovado, restrito, sem anúncio ativo etc. (o último resultado da auditoria de erros)
    const errs = srv.errors.filter((e) => norm(e.ad_account_id) === l.id).flatMap((e) => e.reasons.filter((x) => !NAO_ERRO.test(x)).map((x) => `${e.name ? `${e.name}: ` : ""}${x}`));
    if (errs.length) out.push({ key: "erro_conta", titulo: "Erro na conta", detalhe: `${errs.slice(0, 2).join(" · ")}${errs.length > 2 ? ` (+${errs.length - 2})` : ""}`, sev: "alta", srv: true });
    // mais de 48h sem otimização do gestor
    if (srv.activities && !srv.activitiesFailed?.includes(l.id) && srv.activities[l.id]) {
      const last = srv.activities[l.id].find((a) => a.relevant);
      const horas = last ? (now - Date.parse(last.time)) / 3_600_000 : Infinity;
      if (horas >= SEM_OTIM_H) {
        out.push({ key: "sem_otimizacao", titulo: "Sem otimização há +48h", detalhe: last ? `Última ${ago(last.time)}` : "Nenhuma otimização nos últimos 7 dias", sev: "media", srv: true });
      }
    }
  }
  return out;
}

const pontos = (a: Alerta[]) => a.reduce((s, x) => s + SEV_W[x.sev], 0);

// Etapa 342: geladeira — um alerta de um cliente fica escondido até a data escolhida (ex.: algo que não dá pra reverter
// de imediato). Fica no Supabase (user_ui_prefs "alertas_geladeira"), vale em qualquer navegador.
export type Geladeira = Record<string, string>; // "<conta>|<alerta>" → até (YYYY-MM-DD, inclusive)
const GEL_KEY = "alertas_geladeira";
export const naGeladeira = (gel: Geladeira, conta: string, key: string, hoje = calendarSP().today) => (gel[`${conta}|${key}`] ?? "") >= hoje;
export function useGeladeira() {
  const [gel, setGel] = useState<Geladeira>({});
  const gelRef = useRef<Geladeira>({});
  useEffect(() => {
    fetch(`/api/estrategia/prefs?key=${GEL_KEY}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = d?.value && typeof d.value === "object" ? (d.value as Geladeira) : {};
        gelRef.current = v;
        setGel(v);
      })
      .catch(() => {});
  }, []);
  const congelar = useCallback(async (conta: string, key: string, ate: string | null) => {
    const hoje = calendarSP().today;
    const next: Geladeira = Object.fromEntries(Object.entries(gelRef.current).filter(([, v]) => v >= hoje)); // limpa as vencidas
    if (ate) next[`${conta}|${key}`] = ate;
    else delete next[`${conta}|${key}`];
    gelRef.current = next;
    setGel(next);
    await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: GEL_KEY, value: next }) }).catch(() => {});
  }, []);
  return { gel, congelar };
}

// contexto numérico pra IA sugerir tarefas
function contextoIa(l: Linha, cal = calendarSP()) {
  const n = l.nums;
  const f = (v: number | null | undefined) => (v == null ? null : fmtBRL(v));
  const r = ritmoOf(l.monthly, n?.untilYesterday ?? 0, cal);
  return {
    "CPA ideal": f(l.cpaTarget),
    "CPA hoje": n ? fmtCpa(cpaOf(n.periods.h)) : null,
    "CPA ontem": n ? fmtCpa(cpaOf(n.periods.o)) : null,
    "CPA últimos 3 dias": n ? fmtCpa(cpaOf(n.periods.u3)) : null,
    "verba do mês": f(l.monthly),
    "orçamento diário agora": l.dailyBudget != null ? `${fmtBRL(l.dailyBudget)}/dia` : null,
    "ritmo médio (verba ÷ dias)": r.dailyTarget != null ? `${fmtBRL(r.dailyTarget)}/dia` : null,
  };
}
async function sugerirPara(l: Linha, alertas: Alerta[]): Promise<Array<{ titulo: string; alerta: string }>> {
  const d = await fetch("/api/estrategia/alerta-tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sugerir",
      client_name: l.name,
      responsavel: l.responsible,
      alertas: alertas.map((a) => ({ key: a.key, titulo: a.titulo, detalhe: a.detalhe })),
      contexto: contextoIa(l),
    }),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return (d.tarefas ?? []) as Array<{ titulo: string; alerta: string }>;
}
async function criarPara(l: Linha, tarefas: Array<{ titulo: string; alerta: string }>) {
  const h = l.nums?.periods.h;
  const cpaH = h ? cpaOf(h) : null;
  const d = await fetch("/api/estrategia/alerta-tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "criar", ad_account_id: l.id, client_name: l.name, responsavel: l.responsible, tarefas, cpaHoje: cpaH === Infinity ? "inf" : cpaH }),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
}

// Etapa 342: a IA sugere 1 ou mais tarefas por alerta; você desmarca/edita e cria as que quiser.
function Sugerir({ l, alertas, onCriadas, onCancel }: { l: Linha; alertas: Alerta[]; onCriadas: () => void; onCancel: () => void }) {
  const [lista, setLista] = useState<Array<{ titulo: string; alerta: string; on: boolean }> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const pedir = useCallback(() => {
    setLista(null);
    setErro(null);
    sugerirPara(l, alertas)
      .then((t) => setLista(t.map((x) => ({ ...x, on: true }))))
      .catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pede uma vez por cliente
  }, [l.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pede as sugestões ao abrir
    pedir();
  }, [pedir]);
  async function criar() {
    if (!lista) return;
    setCriando(true);
    setErro(null);
    try {
      await criarPara(
        l,
        lista.filter((x) => x.on && x.titulo.trim()).map(({ titulo, alerta }) => ({ titulo, alerta })),
      );
      onCriadas();
    } catch (e) {
      setErro((e as Error).message);
    }
    setCriando(false);
  }
  const titulo = (k: string) => alertas.find((a) => a.key === k)?.titulo ?? "";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/5 p-2.5 dark:bg-violet-500/10">
      {lista == null && !erro ? <p className="text-xs text-zinc-500">✨ A IA está pensando nas tarefas…</p> : null}
      {lista?.length === 0 ? <p className="text-xs text-zinc-500">A IA não sugeriu nada. Tente de novo ou narre a tarefa.</p> : null}
      {lista?.map((x, i) => (
        <label key={i} className="flex items-start gap-2">
          <input type="checkbox" checked={x.on} onChange={(e) => setLista((cur) => (cur ?? []).map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} className="mt-1.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <input
              value={x.titulo}
              onChange={(e) => setLista((cur) => (cur ?? []).map((y, j) => (j === i ? { ...y, titulo: e.target.value } : y)))}
              aria-label="Título da tarefa"
              className="h-7 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
            />
            {x.alerta ? <span className="text-[11px] text-zinc-500">{titulo(x.alerta)}</span> : null}
          </span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void criar()}
          disabled={criando || !lista?.some((x) => x.on && x.titulo.trim())}
          className="h-7 rounded-md bg-violet-600 px-2.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
        >
          {criando ? "Criando…" : `Criar ${lista?.filter((x) => x.on).length ?? 0} tarefa(s)`}
        </button>
        <button onClick={pedir} disabled={criando || (lista == null && !erro)} className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">
          ↻ Sugerir de novo
        </button>
        <button onClick={onCancel} disabled={criando} className="ml-auto text-xs text-zinc-500 hover:underline">
          cancelar
        </button>
      </div>
      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
    </div>
  );
}

// Reconhecimento de voz do Chrome (sem upload): vai escrevendo enquanto você fala.
type Reconhecedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
function novoReconhecedor(): Reconhecedor | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

function Narrar({ l, alertas, onCriadas, onCancel }: { l: Linha; alertas: Alerta[]; onCriadas: () => void; onCancel: () => void }) {
  const [texto, setTexto] = useState("");
  const [ouvindo, setOuvindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<Reconhecedor | null>(null);
  const base = useRef("");

  function ouvir() {
    setErro(null);
    const r = novoReconhecedor();
    if (!r) {
      setErro("Esse navegador não reconhece voz. Use o Chrome ou escreva a tarefa.");
      return;
    }
    base.current = texto ? `${texto.trim()} ` : "";
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let fala = "";
      for (let i = 0; i < e.results.length; i++) fala += e.results[i][0].transcript;
      setTexto(base.current + fala);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setErro(e.error === "not-allowed" ? "Libere o microfone pro Hub no navegador." : `Voz: ${e.error}`);
    };
    r.onend = () => setOuvindo(false);
    rec.current = r;
    r.start();
    setOuvindo(true);
  }
  function parar() {
    rec.current?.stop();
    setOuvindo(false);
  }
  useEffect(() => () => rec.current?.stop(), []);

  async function criar(semIa: boolean) {
    if (ouvindo) parar();
    setEnviando(true);
    setErro(null);
    try {
      const h = l.nums?.periods.h;
      const cpaH = h ? cpaOf(h) : null;
      const d = await fetch("/api/estrategia/alerta-tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "narrar",
          semIa,
          texto,
          ad_account_id: l.id,
          client_name: l.name,
          responsavel: l.responsible,
          alertas: alertas.map((a) => ({ key: a.key, titulo: a.titulo, detalhe: a.detalhe })),
          cpaHoje: cpaH === Infinity ? "inf" : cpaH,
        }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      onCriadas();
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviando(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-500/40 bg-blue-600/5 p-2.5 dark:bg-blue-500/10">
      <textarea
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder='Fale ou escreva. Ex.: "Cobrar o gestor que o investimento está baixo"'
        aria-label={`Tarefa para ${l.name}`}
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#141924]"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {ouvindo ? (
          <button onClick={parar} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-600 px-2 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Parar
          </button>
        ) : (
          <button onClick={ouvir} className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5">
            🎙 Narrar
          </button>
        )}
        <button
          onClick={() => void criar(false)}
          disabled={enviando || !texto.trim()}
          className="h-7 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {enviando ? "Criando…" : "✨ Criar com IA"}
        </button>
        <button
          onClick={() => void criar(true)}
          disabled={enviando || !texto.trim()}
          title="Salva o texto do jeito que está, sem passar pela IA"
          className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          Salvar como está
        </button>
        <button onClick={onCancel} disabled={enviando} className="ml-auto text-xs text-zinc-500 hover:underline">
          cancelar
        </button>
      </div>
      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
    </div>
  );
}

export function AlertasQuadro({
  linhas,
  srv,
  at,
  isSens,
  geladeira,
}: {
  linhas: Linha[];
  srv: AlertasServer | null;
  at: number | null; // quando as métricas foram atualizadas
  isSens: (id: string) => boolean;
  geladeira: ReturnType<typeof useGeladeira>;
}) {
  const { options } = usePriorityOptions();
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [narrando, setNarrando] = useState<string | null>(null);
  const [sugerindo, setSugerindo] = useState<string | null>(null);
  // Etapa 343: cada cliente fica fechado (só o nome); duplo clique abre os alertas e as tarefas
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setExpandidos((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [gelMenu, setGelMenu] = useState<string | null>(null); // "<conta>|<alerta>" com o menu da geladeira aberto
  const [lote, setLote] = useState<{ feitos: number; total: number; erros: number } | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [filtro, setFiltro] = useState("");
  const tentadas = useRef(new Set<string>());

  const carregar = useCallback(async () => {
    try {
      const d = await fetch("/api/estrategia/alerta-tarefas", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setTarefas(d.tarefas as Tarefa[]);
      setErro(d.semTabela ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase pra liberar as tarefas." : null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  // carrega ao abrir e de novo quando as métricas atualizam (a automação no servidor também fecha tarefas)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as tarefas
    void carregar();
  }, [at, carregar]);

  const cal = useMemo(() => calendarSP(), []);
  const alertasPor = useMemo(() => {
    // "agora" = hora da última atualização das métricas (os alertas valem pra esse momento)
    return new Map(linhas.map((l) => [l.id, alertasDe(l, srv, cal, at ?? 0)]));
  }, [linhas, srv, cal, at]);

  async function acao(body: Record<string, unknown>) {
    const d = await fetch("/api/estrategia/alerta-tarefas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
  }
  async function concluir(t: Tarefa, nota?: string) {
    setTarefas((cur) => (cur ?? []).map((x) => (x.id === t.id ? { ...x, status: "feita", done_at: new Date().toISOString() } : x)));
    try {
      await acao({ action: "concluir", id: t.id, nota });
    } catch (e) {
      setErro((e as Error).message);
      void carregar();
    }
  }
  async function excluir(t: Tarefa) {
    setTarefas((cur) => (cur ?? []).filter((x) => x.id !== t.id));
    try {
      await acao({ action: "excluir", id: t.id });
    } catch (e) {
      setErro((e as Error).message);
      void carregar();
    }
  }

  // fecha sozinho na tela: tarefa de CPA quando o CPA de hoje caiu; outras quando o alerta delas sumiu
  // (só com números mais novos que a tarefa)
  useEffect(() => {
    if (!tarefas || !at) return;
    const srvAt = srv ? Date.parse(srv.at) : 0;
    for (const t of tarefas) {
      if (t.status !== "aberta" || tentadas.current.has(t.id)) continue;
      const meta = parseOrigem(t.origem_key);
      if (!meta?.alerta) continue;
      const criada = Date.parse(t.created_at);
      if (at <= criada) continue;
      const l = linhas.find((x) => x.id === norm(t.ad_account_id));
      if (!l) continue;
      const alertas = alertasPor.get(l.id) ?? [];
      let nota: string | null = null;
      if (CPA_KEYS.has(meta.alerta)) {
        const atual = cpaCaiu(meta.cpaBase, l.nums?.periods.h);
        if (atual != null) nota = `✓ Finalizada sozinha: o CPA de hoje caiu (${meta.cpaBase === Infinity ? "sem lead" : fmtBRL(meta.cpaBase)} → ${fmtBRL(atual)}).`;
      } else {
        const precisaSrv = ["pagamento", "saldo_baixo", "erro_conta", "sem_otimizacao"].includes(meta.alerta);
        if ((!precisaSrv || srvAt > criada) && !alertas.some((a) => a.key === meta.alerta)) nota = "✓ Finalizada sozinha: o alerta sumiu.";
      }
      if (nota) {
        tentadas.current.add(t.id);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- tarefa resolvida pelos números novos
        void concluir(t, nota);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- concluir é estável o suficiente (só mexe em estado)
  }, [tarefas, at, srv, linhas, alertasPor]);

  const hojeIni = useMemo(() => Date.parse(`${cal.today}T03:00:00.000Z`), [cal]);
  const linhasQuadro = useMemo(() => {
    const out: Array<{ l: Linha; alertas: Alerta[]; abertas: Tarefa[]; feitasHoje: Tarefa[]; resolvido: boolean }> = [];
    for (const l of linhas) {
      const alertas = (alertasPor.get(l.id) ?? []).filter((a) => !naGeladeira(geladeira.gel, l.id, a.key, cal.today));
      const minhas = (tarefas ?? []).filter((t) => norm(t.ad_account_id) === l.id);
      const abertas = minhas.filter((t) => t.status === "aberta");
      const feitasHoje = minhas.filter((t) => t.status === "feita" && t.done_at && Date.parse(t.done_at) >= hojeIni);
      if (alertas.length === 0 && abertas.length === 0) continue;
      const resolvido = abertas.length === 0 && feitasHoje.length > 0;
      out.push({ l, alertas, abertas, feitasHoje, resolvido });
    }
    const rank: Record<string, number> = { inauguracao: 0, critica: 1, alta: 2, media: 3, baixa: 4 };
    out.sort((a, b) => pontos(b.alertas) - pontos(a.alertas) || (rank[a.l.priority ?? ""] ?? 5) - (rank[b.l.priority ?? ""] ?? 5) || a.l.name.localeCompare(b.l.name, "pt-BR"));
    return out;
  }, [linhas, alertasPor, tarefas, hojeIni, geladeira.gel, cal]);

  const ativos = linhasQuadro.filter((x) => !x.resolvido);
  const resolvidos = linhasQuadro.filter((x) => x.resolvido);
  // contagem por tipo de alerta (filtro)
  const tipos = useMemo(() => {
    const m = new Map<string, { titulo: string; n: number }>();
    for (const x of ativos) for (const a of x.alertas) {
      const cur = m.get(a.key) ?? { titulo: a.titulo, n: 0 };
      cur.n++;
      m.set(a.key, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [ativos]);
  const mostrar = (verResolvidos ? resolvidos : ativos).filter((x) => !filtro || x.alertas.some((a) => a.key === filtro));
  const nTarefas = ativos.reduce((s, x) => s + x.abertas.length, 0);
  const semTarefa = ativos.filter((x) => x.abertas.length === 0 && x.alertas.length > 0);
  // Etapa 342: a IA cria as tarefas de todos os clientes sem tarefa, um de cada vez (respeita o limite da IA grátis)
  async function gerarTodos() {
    const fila = [...semTarefa];
    setLote({ feitos: 0, total: fila.length, erros: 0 });
    let erros = 0;
    for (let i = 0; i < fila.length; i++) {
      try {
        const t = await sugerirPara(fila[i].l, fila[i].alertas);
        if (t.length) await criarPara(fila[i].l, t);
      } catch (e) {
        erros++;
        setErro(`${fila[i].l.name}: ${(e as Error).message}`);
      }
      setLote({ feitos: i + 1, total: fila.length, erros });
    }
    setLote(null);
    void carregar();
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="text-sm">
          <b className="tabular-nums">{ativos.length}</b> {ativos.length === 1 ? "cliente precisa" : "clientes precisam"} de atenção ·{" "}
          <b className="tabular-nums">{nTarefas}</b> {nTarefas === 1 ? "tarefa aberta" : "tarefas abertas"}
        </div>
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Filtrar por alerta"
          className={`h-8 rounded-lg border bg-white px-2 text-sm dark:bg-[#141924] ${filtro ? "border-blue-500 ring-1 ring-blue-500/40" : "border-zinc-300 dark:border-white/10"}`}
        >
          <option value="">Todos os alertas</option>
          {tipos.map(([k, v]) => (
            <option key={k} value={k}>
              {v.titulo} ({v.n})
            </option>
          ))}
        </select>
        <button
          onClick={() => void gerarTodos()}
          disabled={!!lote || semTarefa.length === 0}
          title="A IA cria tarefas pra cada alerta dos clientes que ainda não têm nenhuma tarefa aberta"
          className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
        >
          {lote ? `✨ Gerando ${lote.feitos}/${lote.total}…` : `✨ Gerar tarefas com IA · ${semTarefa.length} sem tarefa`}
        </button>
        <button
          onClick={() => setExpandidos((cur) => (cur.size ? new Set() : new Set(mostrar.map((x) => x.l.id))))}
          className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
        >
          {expandidos.size ? "Fechar todos" : "Abrir todos"}
        </button>
        <button
          onClick={() => setVerResolvidos((v) => !v)}
          aria-pressed={verResolvidos}
          className={`h-8 rounded-lg border px-3 text-xs font-medium ${verResolvidos ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"}`}
        >
          ✓ Resolvidos hoje · {resolvidos.length}
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          {at ? `números de ${new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""} · atualiza sozinho a cada 30 min (08h às 18h) com a aba aberta
        </span>
        {erro ? <span className="w-full text-xs text-red-600">{erro}</span> : null}
      </Card>

      {mostrar.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">
          {verResolvidos ? "Nenhum cliente resolvido hoje ainda." : linhas.length ? "Nenhum cliente em alerta agora 🎉" : "Carregando…"}
        </div>
      ) : null}

      {mostrar.map(({ l, alertas, abertas, feitasHoje }) => {
        const prio = l.priority ? options.find((o) => o.id === l.priority) : undefined;
        const pior = alertas.some((a) => a.sev === "critico") ? "critico" : alertas.some((a) => a.sev === "alta") ? "alta" : alertas.length ? "media" : null;
        const aberto = expandidos.has(l.id);
        const gelados = (alertasPor.get(l.id) ?? []).filter((a) => naGeladeira(geladeira.gel, l.id, a.key, cal.today));
        // tarefas agrupadas pelo alerta que elas resolvem; as sem alerta (ou de alerta que sumiu) vão em "Outras tarefas"
        const chaves = new Set([...alertas, ...gelados].map((a) => a.key));
        const porAlerta = new Map<string, Tarefa[]>();
        const soltas: Tarefa[] = [];
        for (const t of abertas) {
          const k = parseOrigem(t.origem_key)?.alerta ?? "";
          if (k && chaves.has(k)) porAlerta.set(k, [...(porAlerta.get(k) ?? []), t]);
          else soltas.push(t);
        }
        const tarefaItem = (t: Tarefa) => (
          <div key={t.id} className="group flex items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-[#141924]">
            <input type="checkbox" checked={false} onChange={() => void concluir(t)} aria-label={`Finalizar ${t.titulo}`} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-snug" title={t.descricao && t.descricao !== t.titulo ? t.descricao : undefined}>
                {t.titulo}
              </div>
              <div className="text-[11px] text-zinc-500">
                {ago(t.created_at)}
                {CPA_KEYS.has(parseOrigem(t.origem_key)?.alerta ?? "") ? " · fecha sozinha quando o CPA de hoje cair" : ""}
              </div>
            </div>
            <button onClick={() => void excluir(t)} title="Excluir a tarefa" aria-label={`Excluir ${t.titulo}`} className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600">
              ✕
            </button>
          </div>
        );
        const linhaGrid = "grid gap-2 border-t border-zinc-100 py-2 first:border-t-0 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] dark:border-white/5";
        return (
          <Card
            key={l.id}
            className={`overflow-hidden ${pior === "critico" ? "shadow-[inset_3px_0_0_0_rgb(239_68_68)]" : pior === "alta" ? "shadow-[inset_3px_0_0_0_rgb(249_115_22)]" : ""}`}
          >
            <div
              role="button"
              tabIndex={0}
              aria-expanded={aberto}
              onDoubleClick={() => alternar(l.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") alternar(l.id);
              }}
              title="Duplo clique pra abrir ou fechar"
              className="flex cursor-pointer items-center gap-3 px-4 py-2.5 select-none hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
            >
              <span className="w-3 text-xs text-zinc-400">{aberto ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500 tabular-nums">
                {alertas.length ? (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${pior ? SEV_CLS[pior] : ""}`}>
                    {alertas.length} {alertas.length === 1 ? "alerta" : "alertas"}
                  </span>
                ) : null}
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-white/10">
                  {abertas.length} {abertas.length === 1 ? "tarefa" : "tarefas"}
                </span>
              </span>
            </div>

            {aberto ? (
              <div className="border-t border-zinc-200 px-4 pt-2 pb-3 dark:border-white/10">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {prio ? (
                    <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: prio.color, backgroundColor: `${prio.color}22` }}>
                      ● {prio.label}
                    </span>
                  ) : null}
                  {isSens(l.id) ? <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 font-bold text-fuchsia-700 dark:text-fuchsia-300">⚠ Sensível</span> : null}
                  {l.responsible ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-white/10">👤 {l.responsible}</span> : null}
                  <span className="text-zinc-500 tabular-nums">
                    CPA ideal {fmtBRL(l.cpaTarget)} · hoje {l.nums ? fmtCpa(cpaOf(l.nums.periods.h)) : "—"}
                  </span>
                  <a href={adsManagerUrl(l.id)} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    ↗ Gerenciador
                  </a>
                </div>
                <div className="hidden grid-cols-[minmax(0,19rem)_minmax(0,1fr)] gap-2 pt-1 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase lg:grid">
                  <span>Alerta</span>
                  <span>Tarefas</span>
                </div>

                {alertas.map((a) => {
                  const k = `${l.id}|${a.key}`;
                  const ts = porAlerta.get(a.key) ?? [];
                  return (
                    <div key={a.key} className={linhaGrid}>
                      <div title={a.detalhe} className={`group relative self-start rounded-md border px-2 py-1 pr-6 text-xs ${SEV_CLS[a.sev]}`}>
                        <b>{a.titulo}</b>
                        <span className="block text-[11px] opacity-80">{a.detalhe}</span>
                        <button
                          onClick={() => setGelMenu((cur) => (cur === k ? null : k))}
                          title="Mandar pra geladeira"
                          aria-label={`Mandar ${a.titulo} pra geladeira`}
                          className="absolute top-1 right-1 rounded px-0.5 text-[11px] opacity-50 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10"
                        >
                          ❄
                        </button>
                        {gelMenu === k ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="opacity-80">Geladeira:</span>
                            {[
                              ["3 dias", addDias(cal.today, 2)],
                              ["7 dias", addDias(cal.today, 6)],
                              ["até o fim do mês", `${cal.today.slice(0, 8)}${String(cal.daysInMonth).padStart(2, "0")}`],
                            ].map(([label, ate]) => (
                              <button
                                key={label}
                                onClick={() => {
                                  setGelMenu(null);
                                  void geladeira.congelar(l.id, a.key, ate);
                                }}
                                className="rounded border border-current/30 bg-white/60 px-1.5 py-0.5 font-semibold hover:bg-white dark:bg-black/20 dark:hover:bg-black/40"
                              >
                                {label}
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        {ts.length ? ts.map(tarefaItem) : <span className="py-1 text-xs text-zinc-400">Sem tarefa pra esse alerta</span>}
                      </div>
                    </div>
                  );
                })}

                {gelados.map((a) => (
                  <div key={`gel-${a.key}`} className={`${linhaGrid} opacity-70`}>
                    <div title={a.detalhe} className="self-start rounded-md border border-dashed border-sky-500/50 bg-sky-500/5 px-2 py-1 text-xs text-sky-700 dark:text-sky-300">
                      ❄ <b>{a.titulo}</b>
                      <span className="block text-[11px]">
                        na geladeira até {fmtDia(geladeira.gel[`${l.id}|${a.key}`])} ·{" "}
                        <button onClick={() => void geladeira.congelar(l.id, a.key, null)} className="underline hover:no-underline">
                          tirar
                        </button>
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">{(porAlerta.get(a.key) ?? []).map(tarefaItem)}</div>
                  </div>
                ))}

                {soltas.length ? (
                  <div className={linhaGrid}>
                    <div className="self-start rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-white/10">
                      <b>Outras tarefas</b>
                      <span className="block text-[11px]">sem alerta ligado</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">{soltas.map(tarefaItem)}</div>
                  </div>
                ) : null}

                {verResolvidos && feitasHoje.length ? (
                  <div className="border-t border-zinc-100 py-2 text-xs text-zinc-500 dark:border-white/5">
                    {feitasHoje.map((t) => (
                      <div key={t.id}>
                        ✓ <span className="line-through">{t.titulo}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="border-t border-zinc-100 pt-2 dark:border-white/5">
                  {sugerindo === l.id ? (
                    <Sugerir
                      l={l}
                      alertas={alertas}
                      onCancel={() => setSugerindo(null)}
                      onCriadas={() => {
                        setSugerindo(null);
                        void carregar();
                      }}
                    />
                  ) : narrando === l.id ? (
                    <Narrar
                      l={l}
                      alertas={alertas}
                      onCancel={() => setNarrando(null)}
                      onCriadas={() => {
                        setNarrando(null);
                        void carregar();
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {alertas.length ? (
                        <button
                          onClick={() => setSugerindo(l.id)}
                          className="rounded-md border border-violet-500/50 bg-violet-600/10 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-600/20 dark:text-violet-300"
                        >
                          ✨ Sugerir tarefas (IA)
                        </button>
                      ) : null}
                      <button
                        onClick={() => setNarrando(l.id)}
                        className="rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:border-blue-500 hover:text-blue-700 dark:border-white/15 dark:text-zinc-400 dark:hover:text-blue-300"
                      >
                        🎙 + Nova tarefa
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}

      <p className="px-1 text-[11px] text-zinc-500">
        Alertas: CPA mais de {fmtBRL(CPA_ACIMA)} acima do ideal (3 dias, 2 dias, ontem) · acima de {fmtBRL(MUITO_ALTO)} fica vermelho (CPA muito alto) · gastando sem lead hoje · investimento do mês ±{fmtBRL(INV_MES_FAIXA)} ·
        investimento diário abaixo de 60% do ritmo médio (verba ÷ dias do mês) · não gastou hoje (após 11h) · falha de pagamento · saldo baixo · erro na conta · sem otimização há +48h.
        ❄ manda um alerta pra geladeira (3 dias, 7 dias ou até o fim do mês): ele continua visível, mas apagado, e não conta — cliente só com alertas na geladeira sai do quadro. Inauguração fica fora dos alertas de CPA e de investimento do mês. Tarefa feita sai do quadro; cliente com todas as tarefas feitas vai pra &quot;Resolvidos hoje&quot;.
      </p>
    </div>
  );
}
