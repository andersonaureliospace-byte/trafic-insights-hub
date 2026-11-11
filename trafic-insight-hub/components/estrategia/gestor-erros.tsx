"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Card, Pill } from "@/components/estrategia/ui";
import type { Cliente } from "@/components/estrategia/use-carteira";
import {
  ERRO_TIPOS,
  GESTOR_ERROS_KEY,
  GESTOR_ERROS_MAX,
  normalizeErros,
  novoId,
  type ErroTipo,
  type GestorErro,
} from "@/lib/estrategia/gestor-erros";

// Etapa 302: Configurações → Gestores → Erros dos gestores. Histórico (automação + lançado pelo time), com filtro, inclusão e exclusão.

const sel = "h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]";
const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const lbl = "text-[11px] font-semibold tracking-wide text-zinc-500 uppercase";

async function fetchErros(): Promise<GestorErro[]> {
  const d = await fetch(`/api/estrategia/prefs?key=${GESTOR_ERROS_KEY}`, { cache: "no-store" }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return normalizeErros(d.value);
}

async function putErros(list: GestorErro[]) {
  const d = await fetch("/api/estrategia/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: GESTOR_ERROS_KEY, value: list.slice(0, GESTOR_ERROS_MAX) }),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
}

function agoraLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const fmtQuando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function GestorErros({ gestores, clientes }: { gestores: string[]; clientes: Cliente[] }) {
  const [erros, setErros] = useState<GestorErro[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // filtros
  const [fGestor, setFGestor] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fDias, setFDias] = useState("30");
  // formulário
  const [quando, setQuando] = useState(agoraLocal);
  const [contaId, setContaId] = useState("");
  const [gestor, setGestor] = useState("");
  const [tipo, setTipo] = useState<ErroTipo>("brasil_expansao");
  const [origem, setOrigem] = useState<"time" | "automacao">("time");
  const [detalhe, setDetalhe] = useState("");

  const load = useCallback(async () => {
    try {
      setErros(await fetchErros());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void load();
  }, [load]);

  // sempre relê antes de gravar, pra não apagar o que a automação lançou nesse meio-tempo
  async function mudar(fn: (cur: GestorErro[]) => GestorErro[]) {
    setBusy(true);
    try {
      const next = fn(await fetchErros());
      await putErros(next);
      setErros(next);
      setErr(null);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function adicionar() {
    const c = clientes.find((x) => x.id === contaId);
    if (!c) return;
    const novo: GestorErro = {
      id: novoId(),
      gestor: gestor || c.responsible || null,
      contaId: c.id,
      conta: c.name,
      tipo,
      quando: new Date(quando).toISOString(),
      origem,
      detalhe: detalhe.trim() || undefined,
    };
    const ok = await mudar((cur) => [novo, ...cur].sort((a, b) => b.quando.localeCompare(a.quando)));
    if (ok) {
      setContaId("");
      setGestor("");
      setDetalhe("");
      setQuando(agoraLocal());
      setAberto(false);
    }
  }

  const shown = useMemo(() => {
    const desde = fDias ? Date.now() - Number(fDias) * 86400000 : 0;
    return (erros ?? []).filter(
      (e) =>
        (!fGestor || (fGestor === "__none" ? !e.gestor : e.gestor === fGestor)) &&
        (!fTipo || e.tipo === fTipo) &&
        new Date(e.quando).getTime() >= desde,
    );
  }, [erros, fGestor, fTipo, fDias]);

  const porGestor = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of shown) m.set(e.gestor || "Sem responsável", (m.get(e.gestor || "Sem responsável") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [shown]);

  const contasOrdenadas = useMemo(() => [...clientes].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [clientes]);

  return (
    <Card className="min-w-0 overflow-hidden xl:col-span-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
        <span className="mr-auto text-sm font-semibold">Erros dos gestores</span>
        <label htmlFor="ge-g" className="sr-only">Gestor</label>
        <select id="ge-g" value={fGestor} onChange={(e) => setFGestor(e.target.value)} className={sel}>
          <option value="">Todos os gestores</option>
          {gestores.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
          <option value="__none">Sem responsável</option>
        </select>
        <label htmlFor="ge-t" className="sr-only">Erro</label>
        <select id="ge-t" value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel}>
          <option value="">Todos os erros</option>
          {Object.entries(ERRO_TIPOS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label htmlFor="ge-d" className="sr-only">Período</label>
        <select id="ge-d" value={fDias} onChange={(e) => setFDias(e.target.value)} className={sel}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="">Tudo</option>
        </select>
        <Btn primary small onClick={() => setAberto((v) => !v)}>{aberto ? "Fechar" : "+ Lançar erro"}</Btn>
      </div>

      {aberto ? (
        <form
          className="grid gap-3 border-b border-zinc-200 bg-blue-600/5 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-blue-500/10"
          onSubmit={(e) => {
            e.preventDefault();
            void adicionar();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="ge-conta" className={lbl}>Conta</label>
            <select
              id="ge-conta"
              value={contaId}
              onChange={(e) => {
                setContaId(e.target.value);
                setGestor(clientes.find((c) => c.id === e.target.value)?.responsible ?? "");
              }}
              className={inputCls}
              required
            >
              <option value="">Escolha a conta</option>
              {contasOrdenadas.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ge-gestor" className={lbl}>Gestor</label>
            <select id="ge-gestor" value={gestor} onChange={(e) => setGestor(e.target.value)} className={inputCls}>
              <option value="">Sem responsável</option>
              {gestores.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ge-quando" className={lbl}>Quando</label>
            <input id="ge-quando" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} className={inputCls} required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ge-tipo" className={lbl}>Erro</label>
            <select id="ge-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as ErroTipo)} className={inputCls}>
              {Object.entries(ERRO_TIPOS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Identificado por</span>
            <div className="flex h-9 items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="ge-origem" checked={origem === "time"} onChange={() => setOrigem("time")} className="accent-blue-600" /> Time
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="ge-origem" checked={origem === "automacao"} onChange={() => setOrigem("automacao")} className="accent-blue-600" /> Automação
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ge-det" className={lbl}>Detalhe (opcional)</label>
            <input id="ge-det" value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Ex.: conjunto 'Lookalike 10/11'" className={inputCls} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Btn primary type="submit" disabled={busy || !contaId}>{busy ? "Salvando…" : "Salvar erro"}</Btn>
          </div>
        </form>
      ) : null}

      {porGestor.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-200 px-4 py-2.5 dark:border-white/10">
          {porGestor.map(([g, n]) => (
            <button key={g} onClick={() => setFGestor(g === "Sem responsável" ? "__none" : g)} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10">
              {g} <Pill tone={n >= 3 ? "bad" : "warn"}>{n}</Pill>
            </button>
          ))}
        </div>
      ) : null}

      {err ? <div className="px-4 py-3 text-sm text-red-600">{err}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
              <th className="px-4 py-2.5 font-semibold">Quando</th>
              <th className="px-3 py-2.5 font-semibold">Gestor</th>
              <th className="px-3 py-2.5 font-semibold">Conta</th>
              <th className="px-3 py-2.5 font-semibold">Erro</th>
              <th className="px-3 py-2.5 font-semibold">Identificado por</th>
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {erros == null ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Carregando…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Nenhum erro nesse filtro.</td></tr>
            ) : (
              shown.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-white/5">
                  <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-400">{fmtQuando(e.quando)}</td>
                  <td className="px-3 py-2.5">{e.gestor || <span className="text-zinc-400">—</span>}</td>
                  <td className="px-3 py-2.5 font-medium">{e.conta}</td>
                  <td className="px-3 py-2.5">
                    <div>{ERRO_TIPOS[e.tipo]}</div>
                    {e.detalhe ? <div className="text-xs text-zinc-500">{e.detalhe}</div> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={e.origem === "automacao" ? "warn" : "ok"}>{e.origem === "automacao" ? "🤖 Automação" : "👥 Time"}</Pill>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {confirmId === e.id ? (
                      <span className="inline-flex gap-1">
                        <Btn small disabled={busy} onClick={() => void mudar((cur) => cur.filter((x) => x.id !== e.id)).then(() => setConfirmId(null))}>Apagar</Btn>
                        <Btn small onClick={() => setConfirmId(null)}>Não</Btn>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmId(e.id)} className="text-xs text-zinc-500 hover:text-red-600" aria-label={`Apagar erro de ${e.conta}`}>
                        Apagar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
