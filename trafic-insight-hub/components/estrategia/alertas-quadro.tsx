"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { usePriorityOptions } from "@/lib/priority-context";
import { calendarSP, cpaOf, investimentoBaixo, ritmoOf, type CpaPeriod } from "@/lib/estrategia/calc";
import { CEREBRO_KEY, CEREBRO_PADRAO } from "@/lib/estrategia/cerebro";
import type { AlertasServer } from "./alertas";
import type { Linha } from "./use-carteira";
import { Card, ago, fmtBRL, fmtCpa } from "./ui";

// Etapa 341/345: Acompanhamento → Alertas. Só os clientes que precisam de atenção, pra antecipar problemas.
// Cada cliente fica fechado (só o nome); duplo clique abre: um alerta por linha e, do lado, se ele já foi pedido ao gestor.
// Etapa 345: as tarefas saíram — agora só SOLICITAÇÕES pro gestor: a IA escreve, você edita e envia no WhatsApp dele; fica
// pendente até você dar o ✓ (o gestor deu o OK). Cliente com a solicitação ✓ hoje vai pra "Resolvidos hoje".

export type Sev = "critico" | "alta" | "media";
export interface Alerta {
  key: string;
  titulo: string;
  detalhe: string;
  sev: Sev;
  srv?: boolean; // depende dos dados de saldo/erros/otimização (não só das métricas)
}
interface Solicitacao {
  id: string;
  titulo: string;
  descricao: string;
  ad_account_id: string | null;
  status: "aberta" | "feita";
  done_at: string | null;
  origem_key: string | null; // "ord|<aleatório>|<chaves dos alertas, separadas por vírgula>"
  created_at: string;
}
const alertasDaSol = (s: Solicitacao) => (s.origem_key ?? "").split("|")[2]?.split(",").filter(Boolean) ?? [];


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

// contexto numérico pra IA
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
// Etapa 344: texto das ofertas e das últimas otimizações (pra IA apontar a provável otimização)
function textoOfertas(l: Linha): string {
  const o = l.offers;
  if (!o) return "";
  const st = { geral: o.geral, exame: o.exame.status, promo: o.promoStatus ?? (o.promo.some((p) => p.active) ? "ATIVO" : o.promo.length ? "INATIVO" : "INEXISTENTE") };
  const m = o.metrics?.last2d;
  return (["geral", "exame", "promo"] as const)
    .map((k) => {
      const x = m?.[k];
      const cpa = x && x.spend > 0 ? (x.results > 0 ? fmtBRL(x.spend / x.results) : "sem lead") : null;
      return `${k.toUpperCase()} ${st[k].toLowerCase()}${x && x.spend > 0 ? ` (2 dias fechados: ${fmtBRL(x.spend)} gasto, ${x.results} leads, CPA ${cpa})` : ""}`;
    })
    .join(" · ");
}
function textoOtimizacoes(l: Linha, srv: AlertasServer | null): string {
  const acts = (srv?.activities?.[l.id] ?? []).filter((a) => a.relevant).slice(0, 4);
  return acts.map((a) => `${ago(a.time)}: ${a.what}${a.object ? ` (${a.object})` : ""}`).join(" · ");
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

// Etapa 344/345: a IA escreve a SOLICITAÇÃO pro gestor; você edita (pode ditar) e envia no WhatsApp dele (ou copia/salva).
// Fica pendente até o ✓. Antes de escrever, se a leitura de ofertas da conta não for de hoje, lê de novo na Meta (só dessa conta).
const ymdSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
async function ofertasFrescas(l: Linha): Promise<string> {
  const deHoje = l.offersAt && ymdSP(l.offersAt) === calendarSP().today;
  if (deHoje || !/\bIVS\b/i.test(l.name)) return textoOfertas(l);
  try {
    const d = await fetch("/api/analysis/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountIds: [l.id] }) }).then((r) => r.json());
    const summary = d?.accounts?.[l.id]?.summary ?? d?.accounts?.[`act_${l.id}`]?.summary;
    return summary ? textoOfertas({ ...l, offers: summary }) : textoOfertas(l);
  } catch {
    return textoOfertas(l);
  }
}
function SolicitacaoPainel({ l, alertas, srv, onFeito, onCancel }: { l: Linha; alertas: Alerta[]; srv: AlertasServer | null; onFeito: () => void; onCancel: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [reforco, setReforco] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "enviar" | "salvar">(null);
  const [copiado, setCopiado] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const rec = useRef<Reconhecedor | null>(null);
  const base = useRef("");
  function ditar() {
    setErro(null);
    const r = novoReconhecedor();
    if (!r) {
      setErro("Esse navegador não reconhece voz. Use o Chrome ou escreva.");
      return;
    }
    base.current = texto?.trim() ? `${texto.trimEnd()}\n` : "";
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
  useEffect(() => () => rec.current?.stop(), []);
  const gerar = useCallback(async () => {
    setTexto(null);
    setErro(null);
    const ofertas = await ofertasFrescas(l);
    fetch("/api/estrategia/alerta-tarefas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ordem_gerar",
        ad_account_id: l.id,
        client_name: l.name,
        responsavel: l.responsible,
        alertas: alertas.map((a) => ({ key: a.key, titulo: a.titulo, detalhe: a.detalhe })),
        contexto: contextoIa(l),
        ofertas,
        otimizacoes: textoOtimizacoes(l, srv),
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setTexto(d.mensagem as string);
        setReforco(!!d.reforco);
      })
      .catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gera uma vez por cliente (e no "gerar de novo")
  }, [l.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- gera a solicitação ao abrir
    void gerar();
  }, [gerar]);
  async function salvar(enviar: boolean) {
    if (!texto?.trim()) return;
    setBusy(enviar ? "enviar" : "salvar");
    setErro(null);
    try {
      const d = await fetch("/api/estrategia/alerta-tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ordem_enviar", enviar, ad_account_id: l.id, client_name: l.name, responsavel: l.responsible, mensagem: texto, alertas: alertas.map((a) => a.key) }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      onFeito();
    } catch (e) {
      setErro((e as Error).message);
    }
    setBusy(null);
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-600/5 p-2.5 dark:bg-emerald-500/10">
      <div className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
        📨 Solicitação pro {l.responsible ?? "gestor"}
        {reforco ? <span className="ml-2 font-normal normal-case">· já teve solicitação antes: a IA escreveu como reforço</span> : null}
      </div>
      {texto == null && !erro ? <p className="text-xs text-zinc-500">✨ A IA está escrevendo a solicitação…</p> : null}
      {texto != null ? (
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={Math.min(14, Math.max(6, texto.split("\n").length + 1))}
          aria-label="Solicitação pro gestor"
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm leading-relaxed dark:border-white/10 dark:bg-[#141924]"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void salvar(true)}
          disabled={!!busy || !texto?.trim() || !l.responsible}
          title={l.responsible ? `Manda no WhatsApp do ${l.responsible} (cadastrado em Configurações → Gestores)` : "Essa conta não tem gestor responsável"}
          className="h-7 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy === "enviar" ? "Enviando…" : `📤 Enviar pro ${l.responsible ?? "gestor"}`}
        </button>
        <button
          onClick={() => {
            if (!texto) return;
            void navigator.clipboard.writeText(texto).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            });
          }}
          disabled={!texto}
          className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          {copiado ? "Copiado ✓" : "📋 Copiar"}
        </button>
        <button
          onClick={() => void salvar(false)}
          disabled={!!busy || !texto?.trim()}
          title="Guarda a solicitação como enviada (você mandou por fora) e ela fica esperando o OK"
          className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          {busy === "salvar" ? "Salvando…" : "Salvar (já mandei)"}
        </button>
        {ouvindo ? (
          <button onClick={() => { rec.current?.stop(); setOuvindo(false); }} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-600 px-2 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Parar
          </button>
        ) : (
          <button onClick={ditar} disabled={!!busy || texto == null} title="Fala e vai escrevendo no fim da solicitação" className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">
            🎙 Ditar
          </button>
        )}
        <button onClick={() => void gerar()} disabled={!!busy || (texto == null && !erro)} className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">
          ↻ Gerar de novo
        </button>
        <button onClick={onCancel} disabled={!!busy} className="ml-auto text-xs text-zinc-500 hover:underline">
          cancelar
        </button>
      </div>
      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
    </div>
  );
}

// Etapa 344: o "cérebro" da IA — o que ela sabe dos clientes (ofertas, regras, jeito de otimizar). Vale pras solicitações.
function CerebroModal({ onClose }: { onClose: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/estrategia/prefs?key=${CEREBRO_KEY}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTexto(typeof d?.value === "string" && d.value.trim() ? d.value : CEREBRO_PADRAO))
      .catch(() => setTexto(CEREBRO_PADRAO));
  }, []);
  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const d = await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: CEREBRO_KEY, value: texto ?? "" }) }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      onClose();
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Cérebro da IA">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">🧠 Cérebro da IA</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto p-5">
          <p className="text-xs text-zinc-500">
            Tudo que a IA precisa saber dos seus clientes antes de escrever as solicitações pros gestores: ofertas, o que costuma funcionar, regras, jeito de falar com os
            gestores. Escreva do seu jeito, um assunto por linha. Além disso, ela já recebe sozinha os números de cada conta, as ofertas (GERAL/EXAME/PROMO dos 2 últimos
            dias fechados), as últimas otimizações e as solicitações anteriores.
          </p>
          {texto == null ? (
            <p className="text-sm text-zinc-500">Carregando…</p>
          ) : (
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={16} aria-label="Cérebro da IA" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed dark:border-white/10 dark:bg-[#141924]" />
          )}
          {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
          <button onClick={() => setTexto(CEREBRO_PADRAO)} className="mr-auto text-xs text-zinc-500 hover:underline">voltar pro texto padrão</button>
          <button onClick={onClose} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-white/10">Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando || texto == null} className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
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
  const [sols, setSols] = useState<Solicitacao[]>([]); // pendentes + as com ✓ hoje
  const [erro, setErro] = useState<string | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [solDe, setSolDe] = useState<string | null>(null);
  const [cerebroAberto, setCerebroAberto] = useState(false);
  const [gelMenu, setGelMenu] = useState<string | null>(null);
  // cada cliente fica fechado (só o nome); duplo clique abre
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setExpandidos((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const carregar = useCallback(async () => {
    try {
      const d = await fetch("/api/estrategia/alerta-tarefas", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setSols((d.ordens ?? []) as Solicitacao[]);
      setErro(d.semTabela ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase pra liberar as solicitações." : null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as solicitações
    void carregar();
  }, [at, carregar]);

  const cal = useMemo(() => calendarSP(), []);
  const alertasPor = useMemo(() => new Map(linhas.map((l) => [l.id, alertasDe(l, srv, cal, at ?? 0)])), [linhas, srv, cal, at]);

  async function darOk(s: Solicitacao) {
    setSols((cur) => cur.map((x) => (x.id === s.id ? { ...x, status: "feita", done_at: new Date().toISOString() } : x)));
    try {
      const d = await fetch("/api/estrategia/alerta-tarefas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "concluir", id: s.id }) }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
    } catch (e) {
      setErro((e as Error).message);
      void carregar();
    }
  }

  const linhasQuadro = useMemo(() => {
    const out: Array<{ l: Linha; alertas: Alerta[]; pendentes: Solicitacao[]; okHoje: Solicitacao[]; resolvido: boolean }> = [];
    for (const l of linhas) {
      const alertas = (alertasPor.get(l.id) ?? []).filter((a) => !naGeladeira(geladeira.gel, l.id, a.key, cal.today));
      const minhas = sols.filter((s) => norm(s.ad_account_id) === l.id);
      const pendentes = minhas.filter((s) => s.status === "aberta");
      const okHoje = minhas.filter((s) => s.status === "feita");
      if (alertas.length === 0 && pendentes.length === 0) continue;
      out.push({ l, alertas, pendentes, okHoje, resolvido: pendentes.length === 0 && okHoje.length > 0 });
    }
    const rank: Record<string, number> = { inauguracao: 0, critica: 1, alta: 2, media: 3, baixa: 4 };
    out.sort((a, b) => pontos(b.alertas) - pontos(a.alertas) || (rank[a.l.priority ?? ""] ?? 5) - (rank[b.l.priority ?? ""] ?? 5) || a.l.name.localeCompare(b.l.name, "pt-BR"));
    return out;
  }, [linhas, alertasPor, sols, geladeira.gel, cal]);

  const ativos = linhasQuadro.filter((x) => !x.resolvido);
  const resolvidos = linhasQuadro.filter((x) => x.resolvido);
  const tipos = useMemo(() => {
    const m = new Map<string, { titulo: string; n: number }>();
    for (const x of ativos)
      for (const a of x.alertas) {
        const cur = m.get(a.key) ?? { titulo: a.titulo, n: 0 };
        cur.n++;
        m.set(a.key, cur);
      }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [ativos]);
  const mostrar = (verResolvidos ? resolvidos : ativos).filter((x) => !filtro || x.alertas.some((a) => a.key === filtro));
  const nAguardando = ativos.reduce((s, x) => s + x.pendentes.length, 0);
  const nSemPedido = ativos.filter((x) => x.pendentes.length === 0).length;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="text-sm">
          <b className="tabular-nums">{ativos.length}</b> {ativos.length === 1 ? "cliente precisa" : "clientes precisam"} de atenção ·{" "}
          <b className="tabular-nums">{nSemPedido}</b> sem solicitação · <b className="tabular-nums">{nAguardando}</b> aguardando OK
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
          onClick={() => setCerebroAberto(true)}
          title="O que a IA sabe dos seus clientes (ofertas, regras, jeito de otimizar)"
          className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
        >
          🧠 Cérebro da IA
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

      {mostrar.map(({ l, alertas, pendentes, okHoje }) => {
        const prio = l.priority ? options.find((o) => o.id === l.priority) : undefined;
        const pior = alertas.some((a) => a.sev === "critico") ? "critico" : alertas.some((a) => a.sev === "alta") ? "alta" : alertas.length ? "media" : null;
        const aberto = expandidos.has(l.id);
        const gelados = (alertasPor.get(l.id) ?? []).filter((a) => naGeladeira(geladeira.gel, l.id, a.key, cal.today));
        // em qual solicitação cada alerta já foi pedido
        const pedidoEm = (key: string) => pendentes.find((s) => alertasDaSol(s).includes(key)) ?? okHoje.find((s) => alertasDaSol(s).includes(key)) ?? null;
        const statusPedido = (key: string) => {
          const s = pedidoEm(key);
          if (!s) return <span className="py-1 text-xs text-zinc-400">Ainda não pedido ao gestor</span>;
          return s.status === "feita" ? (
            <span className="py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Pedido e o gestor deu OK</span>
          ) : (
            <span className="py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">📨 Pedido {ago(s.created_at)} · aguardando OK</span>
          );
        };
        const linhaGrid = "grid gap-2 border-t border-zinc-100 py-2 first:border-t-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-center dark:border-white/5";
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
                {pendentes.length ? (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">📨 aguardando OK</span>
                ) : okHoje.length ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">✓ OK hoje</span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-white/10">sem solicitação</span>
                )}
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
                <div className="hidden grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-2 pt-1 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase lg:grid">
                  <span>Alerta</span>
                  <span>Solicitação</span>
                </div>

                {alertas.map((a) => {
                  const k = `${l.id}|${a.key}`;
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
                      <div>{statusPedido(a.key)}</div>
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
                    <div>{statusPedido(a.key)}</div>
                  </div>
                ))}

                {pendentes.length || (verResolvidos && okHoje.length) ? (
                  <div className="flex flex-col gap-1.5 border-t border-zinc-100 py-2 dark:border-white/5">
                    <span className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Solicitações pro gestor</span>
                    {[...pendentes, ...(verResolvidos ? okHoje : [])].map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${s.status === "feita" ? "border-zinc-200 opacity-60 dark:border-white/10" : "border-emerald-500/40 bg-emerald-500/5"}`}
                      >
                        <input
                          type="checkbox"
                          checked={s.status === "feita"}
                          disabled={s.status === "feita"}
                          onChange={() => void darOk(s)}
                          aria-label="O gestor deu o OK"
                          title="Marque quando o gestor der o OK"
                          className="mt-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-zinc-500">
                            {s.titulo.replace(/^Ordem/, "Solicitação")} · {ago(s.created_at)}
                            {s.status === "feita" ? " · ✓ OK do gestor" : " · esperando o OK"}
                          </div>
                          <details>
                            <summary className="cursor-pointer truncate text-sm">
                              {(s.descricao ?? "").split("\n").find((x) => x.trim().startsWith("*"))?.replace(/^\s*\*\s*/, "") ?? "ver solicitação"}
                            </summary>
                            <pre className="mt-1 font-sans text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{s.descricao}</pre>
                          </details>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="border-t border-zinc-100 pt-2 dark:border-white/5">
                  {solDe === l.id ? (
                    <SolicitacaoPainel
                      l={l}
                      alertas={alertas}
                      srv={srv}
                      onCancel={() => setSolDe(null)}
                      onFeito={() => {
                        setSolDe(null);
                        void carregar();
                      }}
                    />
                  ) : (
                    <button onClick={() => setSolDe(l.id)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                      📨 {pendentes.length ? "Nova solicitação (IA)" : "Gerar solicitação pro gestor (IA)"}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}

      {cerebroAberto ? <CerebroModal onClose={() => setCerebroAberto(false)} /> : null}
      <p className="px-1 text-[11px] text-zinc-500">
        Alertas: CPA mais de {fmtBRL(CPA_ACIMA)} acima do ideal (3 dias, 2 dias, ontem) · acima de {fmtBRL(MUITO_ALTO)} fica vermelho (CPA muito alto) · gastando sem lead hoje · investimento do mês ±{fmtBRL(INV_MES_FAIXA)} ·
        investimento diário abaixo de 60% do ritmo médio (verba ÷ dias do mês) · não gastou hoje (após 11h) · falha de pagamento · saldo baixo · erro na conta · sem otimização há +48h.
        ❄ manda um alerta pra geladeira (3 dias, 7 dias ou até o fim do mês): ele continua visível, mas apagado, e não conta — cliente só com alertas na geladeira sai do quadro.
        Solicitação com ✓ hoje leva o cliente pra &quot;Resolvidos hoje&quot;. Inauguração fica fora dos alertas de CPA e de investimento do mês.
      </p>
    </div>
  );
}
