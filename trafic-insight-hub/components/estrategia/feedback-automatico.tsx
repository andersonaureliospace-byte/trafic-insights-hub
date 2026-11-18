"use client";

import { useEffect, useState } from "react";
import { Btn } from "@/components/estrategia/ui";

// Etapa 330: feedback automático pelos números (sem print). Escolhe o período (2, 3 ou 7 dias), a temperatura do cliente
// e clica em Gerar: a IA escreve o feedback (nada técnico, ~60 s) e o plano de ação objetivo. O feedback vai pra revisão
// e envio de sempre (com ou sem print); o plano dá pra salvar no Plano de ação do cliente ou copiar.

type Temperatura = "tranquilo" | "atento" | "reclamando";
interface Ctx {
  temperatura?: Temperatura;
  retorno?: string;
  obs?: string;
  at?: string;
}
const KEY = "feedback_contexto";
const TEMPS: Array<{ id: Temperatura; label: string }> = [
  { id: "tranquilo", label: "😊 Tranquilo" },
  { id: "atento", label: "👀 Atento / cobrando" },
  { id: "reclamando", label: "😟 Reclamando" },
];
const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"}`;

async function lerPref<T>(key: string): Promise<T | null> {
  const d = await fetch(`/api/estrategia/prefs?key=${key}`, { cache: "no-store" }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return (d.value ?? null) as T | null;
}
async function gravarPref(key: string, value: unknown) {
  const d = await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
}

export function FeedbackAutomatico({
  clienteId,
  pontos,
  hoje,
  onUsar,
  onPlanoSalvo,
  ocupado,
}: {
  clienteId: string;
  pontos: string;
  hoje: { spend: number; results: number } | null;
  onUsar: (texto: string) => void; // revisar e enviar esse texto
  onPlanoSalvo: () => void;
  ocupado: boolean;
}) {
  const id = clienteId.replace(/^act_/, "");
  const [dias, setDias] = useState<2 | 3 | 7>(3);
  const [ctx, setCtx] = useState<Ctx>({});
  const [ctxOrig, setCtxOrig] = useState("{}");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [plano, setPlano] = useState("");
  const [dados, setDados] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    lerPref<Record<string, Ctx>>(KEY)
      .then((all) => {
        const c = all?.[id] ?? {};
        setCtx(c);
        setCtxOrig(JSON.stringify(c));
      })
      .catch(() => {});
  }, [id]);

  async function salvarCtx() {
    if (JSON.stringify(ctx) === ctxOrig) return;
    const all = (await lerPref<Record<string, Ctx>>(KEY)) ?? {};
    const novo = { ...ctx, at: new Date().toISOString() };
    await gravarPref(KEY, { ...all, [id]: novo });
    setCtxOrig(JSON.stringify(novo));
  }

  async function gerar() {
    setGerando(true);
    setErro(null);
    setMsg(null);
    try {
      await salvarCtx().catch(() => {});
      const r = await fetch("/api/feedbacks/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: id, dias, pontos, hoje }),
      });
      const txt = await r.text();
      let d: { error?: string; feedback?: string; plano?: string; resumoDados?: string };
      try {
        d = JSON.parse(txt);
      } catch {
        throw new Error(r.status === 504 ? "A IA demorou demais. Tente de novo." : `O servidor respondeu um erro (${r.status}).`);
      }
      if (d.error) throw new Error(d.error);
      setFeedback(d.feedback ?? "");
      setPlano(d.plano ?? "");
      setDados(d.resumoDados ?? "");
    } catch (e) {
      setErro((e as Error).message);
    }
    setGerando(false);
  }

  async function salvarPlano() {
    const t = plano.trim();
    if (!t) return;
    setMsg(null);
    try {
      const all = (await lerPref<Record<string, Array<{ id: string; texto: string; at: string }>>>("notas_clientes")) ?? {};
      const nova = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texto: t, at: new Date().toISOString() };
      await gravarPref("notas_clientes", { ...all, [id]: [nova, ...(all[id] ?? [])].slice(0, 200) });
      setMsg("Plano salvo no Plano de ação ✓");
      onPlanoSalvo();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function copiar(t: string, oque: string) {
    try {
      await navigator.clipboard.writeText(t);
      setMsg(`${oque} copiado ✓`);
    } catch {
      setErro("Não consegui copiar. Selecione o texto e copie com Ctrl+C.");
    }
  }

  const palavras = feedback.trim() ? feedback.trim().split(/\s+/).length : 0;
  const segundos = Math.round(palavras / 2.3);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
      <span className="text-[11px] font-semibold tracking-wide text-blue-700 uppercase dark:text-blue-300">✨ Feedback automático (pelos números, sem print)</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-500">Período:</span>
        {([2, 3, 7] as const).map((n) => (
          <button key={n} type="button" className={chip(dias === n)} onClick={() => setDias(n)}>
            Últimos {n} dias
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-500">Cliente está:</span>
        {TEMPS.map((t) => (
          <button key={t.id} type="button" className={chip(ctx.temperatura === t.id)} onClick={() => setCtx({ ...ctx, temperatura: ctx.temperatura === t.id ? undefined : t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-500">Informações fixas do cliente (ficam salvas){ctx.retorno || ctx.obs ? " ✓" : ""}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={ctx.retorno ?? ""}
            onChange={(e) => setCtx({ ...ctx, retorno: e.target.value })}
            placeholder="Retorno informado pelo cliente (ex.: vendeu R$ 25 mil em outubro, ~5x o investido)"
            aria-label="Retorno informado pelo cliente"
            className={`${inputCls} h-8`}
          />
          <textarea
            value={ctx.obs ?? ""}
            onChange={(e) => setCtx({ ...ctx, obs: e.target.value })}
            rows={2}
            placeholder="Observações (ex.: dono se chama Carlos; prefere mensagem curta; reclamou da qualidade dos contatos)"
            aria-label="Observações sobre o cliente"
            className={`${inputCls} py-1.5`}
          />
          {JSON.stringify(ctx) !== ctxOrig ? (
            <div className="text-right">
              <Btn small onClick={() => void salvarCtx().catch((e) => setErro((e as Error).message))}>Salvar informações</Btn>
            </div>
          ) : null}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Btn small primary onClick={() => void gerar()} disabled={gerando || ocupado}>
          {gerando ? "Gerando…" : feedback ? "↻ Gerar de novo" : "✨ Gerar feedback e plano"}
        </Btn>
        <span className="text-[11px] text-zinc-500">Usa também os pontos de atenção abaixo, se você escrever.</span>
      </div>
      {erro ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{erro}</div> : null}

      {feedback ? (
        <>
          <label htmlFor="fa-feedback" className="mt-1 flex items-center justify-between text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            <span>Feedback pro cliente</span>
            <span className={`font-normal normal-case ${segundos > 60 ? "text-amber-600" : ""}`}>
              {palavras} palavras · ~{segundos}s
            </span>
          </label>
          <textarea id="fa-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={6} className={`${inputCls} py-2`} />
          <div className="flex flex-wrap gap-2">
            <Btn small primary onClick={() => onUsar(feedback.trim())} disabled={ocupado || !feedback.trim()}>
              📤 Revisar e enviar pro grupo
            </Btn>
            <Btn small onClick={() => void copiar(feedback.trim(), "Feedback")}>Copiar</Btn>
          </div>
          <label htmlFor="fa-plano" className="mt-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Plano de ação (objetivo)</label>
          <textarea id="fa-plano" value={plano} onChange={(e) => setPlano(e.target.value)} rows={6} className={`${inputCls} py-2`} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn small onClick={() => void salvarPlano()} disabled={!plano.trim()}>📝 Salvar no Plano de ação</Btn>
            <Btn small onClick={() => void copiar(plano.trim(), "Plano")} disabled={!plano.trim()}>Copiar</Btn>
            {msg ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</span> : null}
          </div>
          {dados ? (
            <details className="text-[11px] text-zinc-500">
              <summary className="cursor-pointer">O que a IA levou em conta</summary>
              <pre className="mt-1 font-sans whitespace-pre-wrap">{dados}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
