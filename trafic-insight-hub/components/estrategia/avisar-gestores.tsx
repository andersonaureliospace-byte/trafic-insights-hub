"use client";

import { useEffect, useMemo, useState } from "react";
import { RITMO_BAND, calendarSP } from "@/lib/estrategia/calc";
import { Btn } from "./ui";
import type { Linha } from "./use-carteira";

// Etapa 272: Tráfego → Acompanhamento → "Avisar gestores". Você marca as contas, escolhe as métricas e o Hub monta o
// relatório — cada métrica numa parte separada, com a conta e o responsável. Investimento é sempre do mês; CPA segue o
// período escolhido no quadro. Cada gestor recebe a SUA mensagem (só as contas dele); no grupo vai uma mensagem só,
// separada por gestor.

export interface LinhaAviso {
  l: Linha;
  cpa: number | null; // CPA no período do quadro (Infinity = gastou sem resultado)
  spend: number | null; // gasto no período do quadro
  leads?: number | null; // Etapa 292: leads no período do quadro
}

type Metrica = "invest" | "cpa";
interface Group {
  id: string;
  name: string;
}

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const brl0 = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Math.round(v));
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SEM = "Sem responsável";

export function AvisarGestores({
  linhas,
  periodLabel,
  onClose,
}: {
  linhas: LinhaAviso[];
  periodLabel: string;
  onClose: () => void;
}) {
  const cal = useMemo(() => calendarSP(), []);
  const mes = useMemo(() => new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" }).format(new Date()), []);
  const [metricas, setMetricas] = useState<Set<Metrica>>(new Set(["invest", "cpa"]));
  const gestoresDasContas = useMemo(
    () => [...new Set(linhas.map((x) => x.l.responsible).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [linhas],
  );
  const [paraGestores, setParaGestores] = useState<Set<string>>(() => new Set(gestoresDasContas));
  const [usarGrupo, setUsarGrupo] = useState(false);
  const [grupo, setGrupo] = useState<Group | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [gq, setGq] = useState("");
  const [comNumero, setComNumero] = useState<Set<string> | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({}); // editados à mão (por gestor / grupo)
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Array<{ para: string; ok: boolean; erro?: string }> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // quem tem WhatsApp cadastrado em Gestores
  useEffect(() => {
    fetch("/api/estrategia/prefs?key=gestores", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = (Array.isArray(d.value) ? d.value : []) as Array<{ name?: string; whatsapp?: string }>;
        setComNumero(new Set(list.filter((g) => g?.name && String(g.whatsapp ?? "").replace(/\D/g, "").length >= 10).map((g) => flat(String(g.name).trim()))));
      })
      .catch(() => setComNumero(new Set()));
  }, []);

  // ---- cada métrica: quem entra e quem fica de fora (em dia) ----
  const invest = useMemo(() => {
    const passed = cal.day - 1;
    const restam = cal.daysInMonth - cal.day + 1;
    const itens: Array<{ l: Linha; linha: string }> = [];
    const fora: string[] = [];
    for (const { l } of linhas) {
      if (!l.monthly || l.monthly <= 0 || !l.nums) {
        fora.push(`${l.name} (sem meta)`);
        continue;
      }
      const ideal = (l.monthly / cal.daysInMonth) * passed;
      const gasto = l.nums.untilYesterday;
      const atraso = ideal - gasto;
      if (passed <= 0 || atraso < RITMO_BAND) {
        fora.push(`${l.name} (em dia)`);
        continue;
      }
      const porDia = Math.max(0, l.monthly - gasto) / restam;
      itens.push({
        l,
        linha: `• ${l.name} — precisa investir ${brl0(atraso)}, está atrasada. Investido ${brl0(gasto)} de ${brl0(ideal)} ideal até ontem (meta ${brl0(l.monthly)}; ${brl0(porDia)}/dia até o fim do mês).`,
      });
    }
    return { itens, fora };
  }, [linhas, cal]);

  const cpa = useMemo(() => {
    const itens: Array<{ l: Linha; linha: string }> = [];
    const fora: string[] = [];
    for (const { l, cpa: c, spend, leads } of linhas) {
      const nLeads = leads != null ? ` · ${Math.round(leads)} lead${Math.round(leads) === 1 ? "" : "s"}` : "";
      if (c === Infinity) {
        itens.push({ l, linha: `• ${l.name} — gastou ${brl(spend ?? 0)} sem nenhum resultado (${periodLabel}).` });
        continue;
      }
      if (c == null || l.cpaTarget == null || c <= l.cpaTarget) {
        fora.push(`${l.name} (${c == null ? "sem gasto" : l.cpaTarget == null ? "sem CPA ideal" : "CPA ok"})`);
        continue;
      }
      itens.push({ l, linha: `• ${l.name} — CPA alto (${periodLabel}): ${brl(c)}, o ideal é ${brl(l.cpaTarget)}${nLeads}.` });
    }
    return { itens, fora };
  }, [linhas, periodLabel]);

  // ---- monta as mensagens: uma por gestor (só as contas dele) e, se ligado, uma pro grupo separada por gestor ----
  const GRUPO = "__grupo__";
  const secoes = useMemo(
    () => (g: string, titulo: (t: string) => string) => {
      const out: string[] = [];
      const de = (x: { l: Linha }) => (x.l.responsible ?? SEM) === g;
      const inv = metricas.has("invest") ? invest.itens.filter(de) : [];
      const cp = metricas.has("cpa") ? cpa.itens.filter(de) : [];
      if (inv.length) out.push(`${titulo(`Investimento abaixo da meta (${mes})`)}\n${inv.map((x) => x.linha).join("\n")}`);
      if (cp.length) out.push(`${titulo(`CPA alto (${periodLabel})`)}\n${cp.map((x) => x.linha).join("\n")}`);
      return out;
    },
    [metricas, invest, cpa, mes, periodLabel],
  );
  const msgs = useMemo(() => {
    const list: Array<{ key: string; para: string; text: string }> = [];
    for (const g of [...paraGestores].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
      const s = secoes(g, (t) => `*${t}*`);
      if (s.length) list.push({ key: g, para: `👤 ${g}`, text: `Oi, ${g.split(" ")[0]}! 📊 Suas contas pra olhar:\n\n${s.join("\n\n")}` });
    }
    if (usarGrupo) {
      const gs = [...new Set(linhas.map((x) => x.l.responsible ?? SEM))].sort((a, b) => (a === SEM ? 1 : b === SEM ? -1 : a.localeCompare(b, "pt-BR")));
      const blocos = gs.map((g) => ({ g, s: secoes(g, (t) => `_${t}_`) })).filter((b) => b.s.length);
      if (blocos.length)
        list.push({
          key: GRUPO,
          para: `👥 ${grupo?.name ?? "grupo (escolha abaixo)"}`,
          text: `📊 *Contas pra olhar*\n\n${blocos.map((b) => `👤 *${b.g}*\n${b.s.join("\n")}`).join("\n\n")}`,
        });
    }
    return list.map((m) => ({ ...m, text: textos[m.key] ?? m.text, editado: m.key in textos }));
  }, [paraGestores, usarGrupo, grupo, linhas, secoes, textos]);

  async function carregarGrupos() {
    if (groups) return;
    try {
      const d = await fetch("/api/whatsapp/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setGroups((d.groups ?? []) as Group[]);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const mensagens = msgs
        .filter((m) => m.key !== GRUPO || grupo)
        .map((m) => (m.key === GRUPO ? { groupId: grupo!.id, text: m.text } : { gestor: m.key, text: m.text }));
      const r = await fetch("/api/estrategia/avisar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagens }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setResultado(r.resultados ?? []);
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviando(false);
  }

  const toggleM = (m: Metrica) =>
    setMetricas((s) => {
      const n = new Set(s);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !enviando && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enviando, onClose]);

  const todosGestores = useMemo(() => {
    const s = new Set(gestoresDasContas);
    return [...s];
  }, [gestoresDasContas]);
  const semNumero = comNumero ? [...paraGestores].filter((g) => !comNumero.has(flat(g))) : [];
  const destinos = msgs.filter((m) => m.key !== GRUPO || grupo).length;
  const pode = destinos > 0 && !enviando && !resultado;
  const toggleG = (g: string) =>
    setParaGestores((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  const foraTodos = [...(metricas.has("invest") ? invest.fora.map((f) => `Investimento: ${f}`) : []), ...(metricas.has("cpa") ? cpa.fora.map((f) => `CPA: ${f}`) : [])];
  const shownGroups = (groups ?? []).filter((g) => flat(g.name).includes(flat(gq))).slice(0, 60);
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Avisar gestores">
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">📣 Avisar gestores · {linhas.length} conta{linhas.length === 1 ? "" : "s"}</h2>
          <button onClick={onClose} disabled={enviando} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Métricas</span>
            <div className="flex flex-wrap gap-2">
              <button className={chip(metricas.has("invest"))} aria-pressed={metricas.has("invest")} onClick={() => toggleM("invest")}>
                Investimento abaixo da meta · {invest.itens.length}
              </button>
              <button className={chip(metricas.has("cpa"))} aria-pressed={metricas.has("cpa")} onClick={() => toggleM("cpa")}>
                CPA alto ({periodLabel}) · {cpa.itens.length}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Enviar para</span>
            <div className="flex flex-wrap gap-2">
              {todosGestores.map((g) => {
                const res = resultado?.find((r) => r.para === g);
                return (
                  <button key={g} className={chip(paraGestores.has(g))} aria-pressed={paraGestores.has(g)} onClick={() => toggleG(g)} disabled={!!resultado}>
                    👤 {g}
                    {semNumero.includes(g) ? " · sem WhatsApp" : ""}
                    {res ? (res.ok ? " ✓" : " ✗") : ""}
                  </button>
                );
              })}
              <button
                className={chip(usarGrupo)}
                aria-pressed={usarGrupo}
                disabled={!!resultado}
                onClick={() => {
                  setUsarGrupo((v) => !v);
                  void carregarGrupos();
                }}
              >
                👥 Um grupo{resultado?.find((r) => r.para === "grupo") ? (resultado.find((r) => r.para === "grupo")?.ok ? " ✓" : " ✗") : ""}
              </button>
            </div>
            {semNumero.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">Sem WhatsApp cadastrado em Gestores: {semNumero.join(", ")} — não vai pra eles.</p>
            ) : null}
            {usarGrupo ? (
              grupo ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">👥 {grupo.name}</span>
                  {!resultado ? <Btn small onClick={() => setGrupo(null)}>Trocar</Btn> : null}
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-200 p-2 dark:border-white/10">
                  <input
                    autoFocus
                    value={gq}
                    onChange={(e) => setGq(e.target.value)}
                    placeholder="Pesquisar grupo…"
                    aria-label="Pesquisar grupo"
                    className="mb-2 h-8 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
                  />
                  <div className="max-h-40 overflow-y-auto">
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
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              {msgs.length === 1 ? "Mensagem" : `${msgs.length} mensagens`} (dá pra editar)
            </span>
            {msgs.length === 0 ? (
              <p className="rounded-lg bg-zinc-100 px-3 py-3 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
                {metricas.size === 0
                  ? "Escolha uma métrica."
                  : paraGestores.size === 0 && !usarGrupo
                    ? "Escolha pra quem enviar."
                    : "Nenhuma das contas escolhidas está fora nas métricas marcadas (pros destinos escolhidos)."}
              </p>
            ) : null}
            {msgs.map((m) => (
              <div key={m.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <b>Para: {m.para}</b>
                  {m.editado && !resultado ? (
                    <button
                      onClick={() =>
                        setTextos((t) => {
                          const n = { ...t };
                          delete n[m.key];
                          return n;
                        })
                      }
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      voltar ao texto automático
                    </button>
                  ) : null}
                </div>
                <textarea
                  value={m.text}
                  onChange={(e) => setTextos((t) => ({ ...t, [m.key]: e.target.value }))}
                  rows={Math.min(14, m.text.split("\n").length + 1)}
                  disabled={!!resultado}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm leading-relaxed dark:border-white/10 dark:bg-[#141924]"
                />
              </div>
            ))}
            {resultado ? (
              <ul className="text-xs">
                {resultado.map((r, i) => (
                  <li key={i} className={r.ok ? "text-emerald-600" : "text-red-600"}>
                    {r.ok ? "✓" : "✗"} {r.para === "grupo" ? `👥 ${grupo?.name ?? "grupo"}` : `👤 ${r.para}`}
                    {r.erro ? ` — ${r.erro}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {foraTodos.length > 0 ? (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">Fora do relatório ({foraTodos.length})</summary>
              <ul className="mt-1 list-inside list-disc">
                {foraTodos.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {erro ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{erro}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
          <Btn onClick={onClose} disabled={enviando}>{resultado ? "Fechar" : "Cancelar"}</Btn>
          {!resultado ? (
            <Btn primary onClick={() => void enviar()} disabled={!pode}>
              {enviando ? "Enviando…" : `📤 Enviar${destinos > 1 ? ` pra ${destinos}` : ""}`}
            </Btn>
          ) : null}
        </div>
      </div>
    </div>
  );
}
