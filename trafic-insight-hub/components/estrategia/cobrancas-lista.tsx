"use client";

import { useMemo, useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import type { AlertasServer } from "./alertas";
import type { Linha } from "./use-carteira";
import { Card, fmtBRL } from "./ui";

// Etapa 353: Cobranças organizada por tipo de conta. Todas as contas da carteira aparecem (não só as com saldo), agrupadas
// em Pré-paga (Pix), Híbrida, Boleto, Cartão e Sem tipo, com selo de "Saldo por fundos". Filtro por tipo com contagem.
// Clicar na conta abre a configuração dela no painel da direita.

export interface PixInfo {
  payment_type: string | null;
  funds_balance_enabled: boolean | null;
  alert_threshold: number | null;
  base_amount: number | null;
}

type Grupo = "pix" | "hybrid" | "boleto" | "card" | "sem";
const GRUPOS: Array<{ id: Grupo; label: string; cor: string; dica: string }> = [
  { id: "pix", label: "Pré-paga (Pix)", cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dica: "Saldo pré-pago: precisa colocar Pix antes de acabar" },
  { id: "hybrid", label: "Híbrida", cor: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dica: "Saldo + cartão de reserva" },
  { id: "boleto", label: "Boleto", cor: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dica: "Paga por boleto" },
  { id: "card", label: "Cartão", cor: "bg-sky-500/15 text-sky-700 dark:text-sky-300", dica: "Cartão não tem saldo (não entra no alerta)" },
  { id: "sem", label: "Sem tipo definido", cor: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300", dica: "Defina o tipo no painel da direita" },
];
const grupoDe = (t: string | null | undefined): Grupo => (t === "pix" || t === "hybrid" || t === "boleto" || t === "card" ? t : "sem");
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CobrancasLista({
  linhas,
  srv,
  pix,
  loading,
  pickedId,
  onPick,
}: {
  linhas: Linha[];
  srv: AlertasServer | null;
  pix: Record<string, PixInfo> | null;
  loading: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Grupo | "todos" | "fundos" | "alerta">("todos");

  const rows = useMemo(() => {
    const bal = new Map((srv?.balance ?? []).map((b) => [b.ad_account_id.replace(/^act_/, ""), b]));
    const pay = new Map((srv?.payment ?? []).map((p) => [p.ad_account_id.replace(/^act_/, ""), p.reason]));
    return linhas.map((l) => {
      const p = pix?.[l.id];
      const b = bal.get(l.id);
      const erroPag = pay.has(l.id) ? (pay.get(l.id) ?? "Erro no pagamento") : null;
      const baixo = !!b && b.low !== false && !b.handled && (b.threshold ?? 0) > 0 && b.balance < b.threshold;
      return { l, grupo: grupoDe(p?.payment_type), fundos: !!p?.funds_balance_enabled, b, erroPag, alerta: !!erroPag || baixo, baixo };
    });
  }, [linhas, srv, pix]);

  const conta = (f: typeof filtro) =>
    rows.filter((r) => (f === "todos" ? true : f === "fundos" ? r.fundos : f === "alerta" ? r.alerta : r.grupo === f)).length;
  const terms = flat(q).split(/\s+/).filter(Boolean);
  const vis = rows
    .filter((r) => (filtro === "todos" ? true : filtro === "fundos" ? r.fundos : filtro === "alerta" ? r.alerta : r.grupo === filtro))
    .filter((r) => terms.every((t) => flat(`${r.l.name} ${r.l.responsible ?? ""}`).includes(t)));

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${on ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"}`;

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={chip(filtro === "todos")} onClick={() => setFiltro("todos")}>Todas · {conta("todos")}</button>
          <button className={chip(filtro === "alerta")} onClick={() => setFiltro("alerta")} title="Saldo abaixo do limite ou erro de pagamento">
            ⚠ Com alerta · {conta("alerta")}
          </button>
          {GRUPOS.map((g) => (
            <button key={g.id} className={chip(filtro === g.id)} onClick={() => setFiltro(g.id)} title={g.dica}>
              {g.label} · {conta(g.id)}
            </button>
          ))}
          <button className={chip(filtro === "fundos")} onClick={() => setFiltro("fundos")} title="Contas em que o saldo da Meta não bate: você informa o saldo real">
            💰 Saldo por fundos · {conta("fundos")}
          </button>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar conta ou gestor"
          aria-label="Pesquisar conta"
          className="h-8 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]"
        />
      </div>

      <div className="max-h-[68vh] overflow-y-auto">
        {pix == null ? <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p> : null}
        {pix != null && vis.length === 0 ? <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta nesse filtro.</p> : null}
        {pix != null
          ? GRUPOS.map((g) => {
              const lista = vis
                .filter((r) => r.grupo === g.id)
                .sort((a, b) => Number(b.alerta) - Number(a.alerta) || a.l.name.localeCompare(b.l.name, "pt-BR"));
              if (lista.length === 0) return null;
              return (
                <section key={g.id}>
                  <h3 className="sticky top-0 z-10 flex items-center gap-2 border-y border-zinc-200 bg-zinc-50 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-white/10 dark:bg-[#0f131b]">
                    <span className={`rounded px-1.5 py-0.5 normal-case ${g.cor}`}>{g.label}</span>
                    {lista.length} {lista.length === 1 ? "conta" : "contas"}
                    {lista.some((r) => r.alerta) ? <span className="text-red-600 normal-case dark:text-red-400">· {lista.filter((r) => r.alerta).length} com alerta</span> : null}
                  </h3>
                  <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                    {lista.map((r) => {
                      const temSaldo = g.id === "pix" || g.id === "hybrid" || g.id === "boleto";
                      return (
                        <li
                          key={r.l.id}
                          onClick={() => onPick(r.l.id)}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/[0.03] ${
                            pickedId === r.l.id ? "ring-2 ring-blue-500/60 ring-inset" : ""
                          } ${r.alerta ? "bg-red-500/10 shadow-[inset_3px_0_0_0] shadow-red-500" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <a
                                href={adsManagerUrl(r.l.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="truncate text-sm font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                              >
                                {r.l.name}
                              </a>
                              {r.fundos ? (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300" title="Saldo por fundos ligado">
                                  💰 por fundos
                                </span>
                              ) : null}
                              {r.l.responsible ? <span className="text-[11px] text-zinc-500">· {r.l.responsible}</span> : null}
                            </div>
                            <div className="text-xs text-zinc-500 tabular-nums">
                              {r.erroPag ? (
                                <span className="font-semibold text-red-600 dark:text-red-400">{r.erroPag}</span>
                              ) : temSaldo ? (
                                r.b ? (
                                  <>
                                    Saldo <b className={r.baixo ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}>{fmtBRL(r.b.balance)}</b>
                                    {r.b.threshold > 0 ? ` · avisa abaixo de ${fmtBRL(r.b.threshold)}` : " · sem limite configurado"}
                                    {r.b.handled ? " · Pix/boleto enviado agora há pouco" : ""}
                                  </>
                                ) : loading && !srv ? (
                                  "buscando saldo…"
                                ) : (
                                  "saldo não lido — confira o limite no painel ou clique em Atualizar"
                                )
                              ) : g.id === "card" ? (
                                "cartão: sem saldo pra acompanhar"
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400">defina o tipo de conta →</span>
                              )}
                            </div>
                          </div>
                          {r.erroPag ? (
                            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PAGAMENTO</span>
                          ) : r.baixo ? (
                            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">SALDO BAIXO</span>
                          ) : temSaldo && r.b ? (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">OK</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          : null}
      </div>
      <div className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-white/10">
        Vermelho: saldo abaixo do limite ou erro de pagamento · clique na conta pra configurar no painel da direita
      </div>
    </Card>
  );
}
