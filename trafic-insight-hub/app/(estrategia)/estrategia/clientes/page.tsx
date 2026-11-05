"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { loadClientes, loadOfferFlags, matchesResp, saveOfferFlags, type Cliente, type OfferFlags } from "@/components/estrategia/use-carteira";
import { Btn, Card, Pill, fmtBRL } from "@/components/estrategia/ui";
import { ClientesTabs } from "@/components/estrategia/clientes-tabs";
import { NovoClienteDialog } from "@/components/estrategia/novo-cliente-dialog";
import { usePriorityOptions } from "@/lib/priority-context";
import { calendarSP } from "@/lib/estrategia/calc";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 238: Hub estratégico → Clientes. Lista + ficha do cliente (responsável, status, verba, CPA ideal, pagamento,
// cliente desde). Arquivar tira o cliente de todas as telas e das automações, sem apagar nada (dá pra trazer de volta).

type Status = "ativo" | "inauguracao" | "pausado";
const STATUS_LABEL: Record<Status, string> = { ativo: "Ativo", inauguracao: "Inauguração", pausado: "Pausado" };
const PAY_LABEL: Record<string, string> = { pix: "Pix (pré-paga)", hybrid: "Híbrida", boleto: "Boleto", card: "Cartão" };

function statusOf(c: Cliente): Status {
  if (!c.active) return "pausado";
  if (c.priority === "inauguracao") return "inauguracao";
  return "ativo";
}

interface Form {
  name: string; // Etapa 255: nome do cliente editável na ficha
  responsible: string;
  status: Status;
  monthly: string;
  cpaTarget: string;
  payment: string;
  since: string; // YYYY-MM
  exame: boolean; // Etapa 242: anuncia EXAME
  boleto: boolean; // Etapa 242: anuncia BOLETO
}

function formOf(c: Cliente, pay: string | null, f: OfferFlags | undefined): Form {
  return {
    name: c.name,
    responsible: c.responsible ?? "",
    status: statusOf(c),
    monthly: c.monthly != null ? String(c.monthly) : "",
    cpaTarget: c.cpaTarget != null ? String(c.cpaTarget) : "",
    payment: pay ?? "",
    since: c.clientSince ? c.clientSince.slice(0, 7) : "",
    exame: !!f?.exame,
    boleto: !!f?.boleto,
  };
}

const num = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function ClientesPage() {
  const { ui, gestores } = useEstr();
  const { options } = usePriorityOptions();
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [pay, setPay] = useState<Record<string, string | null>>({});
  const [flags, setFlags] = useState<Record<string, OfferFlags>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [novoOpen, setNovoOpen] = useState(false); // Etapa 253
  const [q, setQ] = useState(""); // pesquisa pelo nome do cliente
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, p, f] = await Promise.all([
        loadClientes(),
        fetch("/api/pix-accounts", { cache: "no-store" }).then((r) => r.json()),
        loadOfferFlags().catch(() => ({}) as Record<string, OfferFlags>),
      ]);
      setFlags(f);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ficha acompanha o cliente escolhido
    setForm(cur ? formOf(cur, pay[cur.id] ?? null, flags[cur.id]) : null);
    setConfirmArchive(false);
    setMsg(null);
  }, [cur, pay, flags]);

  async function patchBinding(c: Cliente, body: Record<string, unknown>) {
    const d = await fetch("/api/account-bindings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: c.rawId, ...body }),
    }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
  }

  async function save() {
    if (!cur || !form) return;
    setSaving(true);
    setMsg(null);
    try {
      if (!form.name.trim()) throw new Error("O nome do cliente não pode ficar vazio.");
      const body: Record<string, unknown> = {
        responsible: form.responsible || null,
        monthly_investment: num(form.monthly),
        cpa_target: num(form.cpaTarget),
        client_since: form.since ? `${form.since}-01` : null,
      };
      if (form.name.trim() !== cur.name) body.client_name = form.name.trim();
      const before = statusOf(cur);
      if (form.status !== before) {
        body.active = form.status !== "pausado";
        if (form.status === "inauguracao") body.priority = "inauguracao";
        else if (cur.priority === "inauguracao") body.priority = null;
      }
      await patchBinding(cur, body);
      const f0 = flags[cur.id];
      if (!f0 || f0.exame !== form.exame || f0.boleto !== form.boleto) {
        const latest = await loadOfferFlags().catch(() => flags);
        await saveOfferFlags({ ...latest, [cur.id]: { exame: form.exame, boleto: form.boleto } });
      }
      if ((pay[cur.id] ?? "") !== form.payment) {
        const d = await fetch("/api/pix-accounts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_account_id: cur.rawId, payment_type: form.payment || null }),
        }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
      }
      setMsg({ ok: true, text: "Alterações salvas." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function archive(value: boolean) {
    if (!cur) return;
    setSaving(true);
    try {
      await patchBinding(cur, { archived: value });
      setConfirmArchive(false);
      setSel(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const prioLabel = (id: string | null) => (id ? (options.find((o) => o.id === id)?.label ?? id) : "—");

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
          {!cur || !form ? (
            <p className="text-sm text-zinc-500">Escolha um cliente na lista.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold">{cur.name}</h2>
                <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Ficha do cliente</div>
              </div>
              {cur.archived ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-zinc-500">Cliente arquivado: não aparece nas telas nem entra nas automações. Os dados continuam guardados.</p>
                  <Btn primary onClick={() => void archive(false)} disabled={saving}>Trazer de volta</Btn>
                </div>
              ) : (
                <>
                  <Field label="Nome do cliente" htmlFor="f-nome">
                    <input id="f-nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Responsável" htmlFor="f-resp">
                    <select id="f-resp" value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} className={inputCls}>
                      <option value="">Sem responsável</option>
                      {[...new Set([...gestores, ...(form.responsible ? [form.responsible] : [])])].map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status" htmlFor="f-status">
                    <select id="f-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} className={inputCls}>
                      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Verba mensal (R$)" htmlFor="f-verba">
                      <input id="f-verba" inputMode="decimal" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="CPA ideal (R$)" htmlFor="f-cpa">
                      <input id="f-cpa" inputMode="decimal" value={form.cpaTarget} onChange={(e) => setForm({ ...form, cpaTarget: e.target.value })} className={inputCls} />
                    </Field>
                  </div>
                  {num(form.monthly) ? (
                    <div className="-mt-2 text-xs text-zinc-500">≈ {fmtBRL((num(form.monthly) as number) / calendarSP().daysInMonth)} por dia neste mês</div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pagamento" htmlFor="f-pay">
                      <select id="f-pay" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} className={inputCls}>
                        <option value="">Não definido</option>
                        {Object.entries(PAY_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Cliente desde" htmlFor="f-since">
                      <input id="f-since" type="month" value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Ofertas que a conta anuncia">
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                      <span className="flex items-center gap-2 text-zinc-500">
                        <input type="checkbox" checked disabled className="h-4 w-4" /> GERAL (todas)
                      </span>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={form.exame} onChange={(e) => setForm({ ...form, exame: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                        EXAME
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={form.boleto} onChange={(e) => setForm({ ...form, boleto: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                        BOLETO
                      </label>
                    </div>
                    {!flags[cur.id] ? <p className="text-xs text-amber-600 dark:text-amber-400">Ainda não definido. Marque e salve.</p> : null}
                  </Field>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-zinc-500">Conta de anúncio</dt>
                    <dd className="font-mono text-xs break-all">
                      <a
                        href={adsManagerUrl(cur.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir no Gerenciador de Anúncios"
                        className="text-blue-700 hover:underline dark:text-blue-300"
                      >
                        act_{cur.id} ↗
                      </a>
                    </dd>
                    <dt className="text-zinc-500">Prioridade Asana</dt>
                    <dd className="font-medium">{prioLabel(cur.priority)}</dd>
                    <dt className="text-zinc-500">WhatsApp</dt>
                    <dd>{cur.whatsapp ?? "—"}</dd>
                    <dt className="text-zinc-500">Grupo WhatsApp</dt>
                    <dd className="text-zinc-500 italic">em breve</dd>
                  </dl>
                  {msg ? <div className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</div> : null}
                  <div className="flex items-center gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
                    <div className="flex-1">
                      <Btn primary onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</Btn>
                    </div>
                    {confirmArchive ? (
                      <>
                        <Btn onClick={() => setConfirmArchive(false)}>Cancelar</Btn>
                        <button
                          onClick={() => void archive(true)}
                          disabled={saving}
                          className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Arquivar
                        </button>
                      </>
                    ) : (
                      <Btn onClick={() => setConfirmArchive(true)} title="Arquivar cliente (some das telas, dá pra trazer de volta)">
                        🗑 Arquivar
                      </Btn>
                    )}
                  </div>
                  {confirmArchive ? (
                    <p className="text-xs text-zinc-500">
                      O cliente some das telas e sai das automações. Nada é apagado: dá pra trazer de volta em &quot;Ver arquivados&quot;.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
