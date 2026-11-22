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
// Cada linha: card do cliente | alertas | tarefas. As tarefas você narra (ou escreve) e a IA anota.
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
}: {
  linhas: Linha[];
  srv: AlertasServer | null;
  at: number | null; // quando as métricas foram atualizadas
  isSens: (id: string) => boolean;
}) {
  const { options } = usePriorityOptions();
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [narrando, setNarrando] = useState<string | null>(null);
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
      const alertas = alertasPor.get(l.id) ?? [];
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
  }, [linhas, alertasPor, tarefas, hojeIni]);

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

      <div className="hidden grid-cols-[17rem_minmax(0,1fr)_minmax(0,1.15fr)] gap-3 px-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase lg:grid">
        <span>Cliente</span>
        <span>Alertas</span>
        <span>Tarefas</span>
      </div>

      {mostrar.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">
          {verResolvidos ? "Nenhum cliente resolvido hoje ainda." : linhas.length ? "Nenhum cliente em alerta agora 🎉" : "Carregando…"}
        </div>
      ) : null}

      {mostrar.map(({ l, alertas, abertas, feitasHoje }) => {
        const prio = l.priority ? options.find((o) => o.id === l.priority) : undefined;
        const pior = alertas.some((a) => a.sev === "critico") ? "critico" : alertas.some((a) => a.sev === "alta") ? "alta" : alertas.length ? "media" : null;
        return (
          <Card
            key={l.id}
            className={`grid gap-3 p-3 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1.15fr)] ${
              pior === "critico" ? "shadow-[inset_3px_0_0_0_rgb(239_68_68)]" : pior === "alta" ? "shadow-[inset_3px_0_0_0_rgb(249_115_22)]" : ""
            }`}
          >
            {/* cliente */}
            <div className="min-w-0 pl-1">
              <a
                href={adsManagerUrl(l.id)}
                target="_blank"
                rel="noopener noreferrer"
                title={`${l.name} — abrir no Gerenciador`}
                className="block truncate text-sm font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
              >
                {l.name}
              </a>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {prio ? (
                  <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: prio.color, backgroundColor: `${prio.color}22` }}>
                    ● {prio.label}
                  </span>
                ) : null}
                {isSens(l.id) ? <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 font-bold text-fuchsia-700 dark:text-fuchsia-300">⚠ Sensível</span> : null}
                {l.responsible ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-white/10">👤 {l.responsible}</span> : null}
              </div>
              <div className="mt-1.5 text-[11px] text-zinc-500 tabular-nums">
                CPA ideal {fmtBRL(l.cpaTarget)} · hoje {l.nums ? fmtCpa(cpaOf(l.nums.periods.h)) : "—"}
              </div>
            </div>

            {/* alertas */}
            <div className="flex min-w-0 flex-wrap content-start gap-1.5">
              {alertas.length === 0 ? <span className="text-xs text-zinc-400">Sem alerta agora</span> : null}
              {alertas.map((a) => (
                <span key={a.key} title={a.detalhe} className={`max-w-full rounded-md border px-2 py-1 text-xs ${SEV_CLS[a.sev]}`}>
                  <b>{a.titulo}</b>
                  <span className="block truncate text-[11px] opacity-80">{a.detalhe}</span>
                </span>
              ))}
            </div>

            {/* tarefas */}
            <div className="flex min-w-0 flex-col gap-1.5">
              {abertas.map((t) => (
                <div key={t.id} className="group flex items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-[#141924]">
                  <input type="checkbox" checked={false} onChange={() => void concluir(t)} aria-label={`Finalizar ${t.titulo}`} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug" title={t.descricao && t.descricao !== t.titulo ? `Você narrou: ${t.descricao}` : undefined}>
                      {t.titulo}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {ago(t.created_at)}
                      {(() => {
                        const m = parseOrigem(t.origem_key);
                        const a = m?.alerta ? alertas.find((x) => x.key === m.alerta) : undefined;
                        return m?.alerta ? ` · ${a?.titulo ?? m.alerta}${CPA_KEYS.has(m.alerta) ? " (fecha quando o CPA de hoje cair)" : ""}` : "";
                      })()}
                    </div>
                  </div>
                  <button onClick={() => void excluir(t)} title="Excluir a tarefa" aria-label={`Excluir ${t.titulo}`} className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600">
                    ✕
                  </button>
                </div>
              ))}
              {feitasHoje.length && verResolvidos
                ? feitasHoje.map((t) => (
                    <div key={t.id} className="flex items-start gap-2 px-2 text-xs text-zinc-500">
                      <span>✓</span>
                      <span className="line-through">{t.titulo}</span>
                    </div>
                  ))
                : null}
              {narrando === l.id ? (
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
                <button
                  onClick={() => setNarrando(l.id)}
                  className="self-start rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:border-blue-500 hover:text-blue-700 dark:border-white/15 dark:text-zinc-400 dark:hover:text-blue-300"
                >
                  🎙 + Nova tarefa
                </button>
              )}
            </div>
          </Card>
        );
      })}

      <p className="px-1 text-[11px] text-zinc-500">
        Alertas: CPA mais de {fmtBRL(CPA_ACIMA)} acima do ideal (3 dias, 2 dias, ontem) · acima de {fmtBRL(MUITO_ALTO)} fica vermelho (CPA muito alto) · gastando sem lead hoje · investimento do mês ±{fmtBRL(INV_MES_FAIXA)} ·
        investimento diário abaixo de 60% do ritmo médio (verba ÷ dias do mês) · não gastou hoje (após 11h) · falha de pagamento · saldo baixo · erro na conta · sem otimização há +48h.
        Inauguração fica fora dos alertas de CPA e de investimento do mês. Tarefa feita sai do quadro; cliente com todas as tarefas feitas vai pra &quot;Resolvidos hoje&quot;.
      </p>
    </div>
  );
}
