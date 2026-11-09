"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { loadClientes, matchesResp, type Cliente } from "@/components/estrategia/use-carteira";
import { Btn, Card, Pill, fmtBRL } from "@/components/estrategia/ui";
import { ClientesTabs } from "@/components/estrategia/clientes-tabs";
import { NovoClienteDialog } from "@/components/estrategia/novo-cliente-dialog";
import { FichaCliente, PAY_LABEL, statusOf } from "@/components/estrategia/ficha-cliente";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 238: Hub estratégico → Clientes. Lista + ficha do cliente. Arquivar tira o cliente de todas as telas e das
// automações, sem apagar nada (dá pra trazer de volta). Etapa 296: a ficha virou um componente (FichaCliente), o mesmo
// que abre no Acompanhamento.

const STATUS_LABEL = { ativo: "Ativo", inauguracao: "Inauguração", pausado: "Pausado" } as const;

export default function ClientesPage() {
  const { ui, gestores } = useEstr();
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [pay, setPay] = useState<Record<string, string | null>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [novoOpen, setNovoOpen] = useState(false); // Etapa 253
  const [q, setQ] = useState(""); // pesquisa pelo nome do cliente
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, p] = await Promise.all([loadClientes(), fetch("/api/pix-accounts", { cache: "no-store" }).then((r) => r.json())]);
      setClientes(list.filter((c) => c.selected || c.archived));
      const map: Record<string, string | null> = {};
      for (const r of (p.pixAccounts ?? []) as Array<{ ad_account_id: string; payment_type: string | null }>) {
        map[r.ad_account_id.replace(/^act_/, "")] = r.payment_type;
      }
      setPay(map);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a lista ao abrir
    void load();
  }, [load]);

  const list = useMemo(
    () => {
      // Pesquisa sem diferenciar acento nem maiúscula; cada palavra digitada precisa aparecer no nome.
      const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const terms = flat(q).split(/\s+/).filter(Boolean);
      return (clientes ?? []).filter(
        (c) =>
          (showArchived ? c.archived : !c.archived) &&
          matchesResp(ui.resp, c.responsible) &&
          (terms.length === 0 || terms.every((t) => flat(c.name).includes(t))),
      );
    },
    [clientes, showArchived, ui.resp, q],
  );
  const cur = useMemo(() => list.find((c) => c.id === sel) ?? list[0] ?? null, [list, sel]);

  return (
    <div className="flex flex-col">
      <PageHeader title="Clientes" sub="Ficha de cada cliente da carteira">
        <Btn onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Ver ativos" : "Ver arquivados"}</Btn>
        <Btn primary onClick={() => setNovoOpen(true)}>+ Novo cliente</Btn>
      </PageHeader>
      {novoOpen ? (
        <NovoClienteDialog
          clientes={clientes ?? []}
          gestores={gestores}
          payLabels={PAY_LABEL}
          onClose={() => setNovoOpen(false)}
          onCreated={(id) => {
            setNovoOpen(false);
            setShowArchived(false);
            setQ("");
            setSel(id);
            void load();
          }}
        />
      ) : null}
      <ClientesTabs />
      <div className="grid gap-4 p-4 lg:p-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <div className="relative">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Pesquisar cliente pelo nome…"
                  aria-label="Pesquisar cliente pelo nome"
                  className="h-8 w-72 rounded-lg border border-zinc-300 bg-white px-2 pr-7 text-sm dark:border-white/10 dark:bg-[#141924]"
                />
                {q ? (
                  <button onClick={() => setQ("")} aria-label="Limpar pesquisa" className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-zinc-400">
                    ✕
                  </button>
                ) : null}
              </div>
              <span className="ml-auto text-xs text-zinc-500">{clientes == null ? "" : `${list.length} ${list.length === 1 ? "cliente" : "clientes"}`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                    <th className="px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 font-semibold">Responsável</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Verba mensal</th>
                    <th className="px-3 py-2.5 text-right font-semibold">CPA ideal</th>
                    <th className="px-3 py-2.5 font-semibold">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes == null ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Carregando…</td>
                    </tr>
                  ) : list.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                        {q.trim()
                          ? `Nenhum cliente com "${q.trim()}".`
                          : showArchived
                            ? "Nenhum cliente arquivado."
                            : "Nenhum cliente pra esse responsável."}
                      </td>
                    </tr>
                  ) : (
                    list.map((c) => {
                      const st = statusOf(c);
                      const on = cur?.id === c.id;
                      return (
                        <tr
                          key={c.id}
                          tabIndex={0}
                          onClick={() => setSel(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setSel(c.id);
                          }}
                          className={`cursor-pointer border-b border-zinc-100 last:border-0 dark:border-white/5 ${
                            on ? "bg-blue-600/8 dark:bg-blue-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <td className="px-4 py-3 font-semibold">
                            {/* Etapa 248: atalho pro Gerenciador (não troca a ficha ao clicar) */}
                            <a
                              href={adsManagerUrl(c.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Abrir no Gerenciador de Anúncios"
                              className="group inline-flex items-center gap-1.5 hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                            >
                              {c.name}
                              <span aria-hidden className="text-xs font-normal text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">↗</span>
                            </a>
                          </td>
                          <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400">{c.responsible ?? "—"}</td>
                          <td className="px-3 py-3">
                            <Pill tone={c.archived ? "off" : st === "ativo" ? "ok" : st === "inauguracao" ? "info" : "warn"}>
                              {c.archived ? "Arquivado" : STATUS_LABEL[st]}
                            </Pill>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmtBRL(c.monthly)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{fmtBRL(c.cpaTarget)}</td>
                          <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400">{pay[c.id] ? PAY_LABEL[pay[c.id] as string] : "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-zinc-500">
            Pra cadastrar gestores e atribuir várias contas de uma vez, use{" "}
            <Link href="/estrategia/gestores" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Configurações → Gestores</Link>.
          </p>
        </div>

        <Card className="h-fit p-5 xl:sticky xl:top-16">
          {!cur ? (
            <p className="text-sm text-zinc-500">Escolha um cliente na lista.</p>
          ) : (
            <FichaCliente
              key={cur.id}
              id={cur.id}
              onSaved={() => void load()}
              onArchived={() => {
                setSel(null);
                void load();
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
