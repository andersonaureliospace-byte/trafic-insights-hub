"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn } from "@/components/estrategia/ui";
import { normId, type Cliente } from "@/components/estrategia/use-carteira";
import type { AdAccount } from "@/lib/meta/insights";

// Etapa 253: "+ Novo cliente" no Hub estratégico. Antes, cliente novo só entrava pelo hub operacional (Painel → Contas
// exibidas + preencher a ficha). Aqui faz as duas coisas de uma vez: escolhe a conta de anúncio da Meta, preenche a ficha
// e a conta já entra nas "Contas exibidas" (as automações e as outras telas passam a ver o cliente).

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const num = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

async function send(url: string, method: string, body: unknown) {
  const d = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d;
}

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

export function NovoClienteDialog({
  clientes,
  gestores,
  payLabels,
  onClose,
  onCreated,
}: {
  clientes: Cliente[];
  gestores: string[];
  payLabels: Record<string, string>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [conta, setConta] = useState<AdAccount | null>(null);
  const [nome, setNome] = useState("");
  const [resp, setResp] = useState("");
  const [verba, setVerba] = useState("");
  const [cpa, setCpa] = useState("");
  const [pay, setPay] = useState("");
  const [since, setSince] = useState(() => new Date().toISOString().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const loadAccounts = useCallback(async (fresh: boolean) => {
    setRefreshing(fresh);
    setLoadErr(null);
    try {
      const d = await fetch(`/api/meta/accounts${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (d.error) setLoadErr(d.error);
      else setAccounts((d.accounts ?? []) as AdAccount[]);
    } catch (e) {
      setLoadErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as contas da Meta ao abrir
    void loadAccounts(false);
  }, [loadAccounts]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, saving]);

  // Situação de cada conta na carteira: já é cliente, está arquivada, ou livre pra cadastrar.
  const situacao = useMemo(() => {
    const m: Record<string, "ativo" | "arquivado"> = {};
    for (const c of clientes) {
      if (c.archived) m[c.id] = "arquivado";
      else if (c.selected) m[c.id] = "ativo";
    }
    return m;
  }, [clientes]);

  const lista = useMemo(() => {
    const terms = flat(q).split(/\s+/).filter(Boolean);
    return (accounts ?? [])
      .filter((a) => terms.every((t) => flat(`${a.name} ${a.account_id}`).includes(t)))
      .sort((a, b) => {
        const sa = situacao[normId(a.account_id)] ? 1 : 0;
        const sb = situacao[normId(b.account_id)] ? 1 : 0;
        return sa - sb || a.name.localeCompare(b.name, "pt-BR");
      });
  }, [accounts, q, situacao]);

  function escolher(a: AdAccount) {
    setConta(a);
    setNome(a.name);
    setErr(null);
  }

  // Etapa 254: conta que não veio na lista → pergunta direto pra Meta pelo ID.
  const idDigitado = q.replace(/\D/g, "");
  async function verificarId() {
    setChecking(true);
    setCheckMsg(null);
    try {
      const d = await fetch(`/api/meta/account-lookup?id=${idDigitado}`, { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      const a = d.account as AdAccount;
      setAccounts((cur) => (cur && !cur.some((x) => x.account_id === a.account_id) ? [a, ...cur] : cur));
      if (situacao[normId(a.account_id)]) setCheckMsg(`${a.name} já está na carteira.`);
      else escolher(a);
    } catch (e) {
      setCheckMsg((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function salvar() {
    if (!conta) return;
    if (!nome.trim()) return setErr("Dê um nome pro cliente.");
    setSaving(true);
    setErr(null);
    try {
      const id = normId(conta.account_id);
      await send("/api/account-bindings", "PATCH", {
        ad_account_id: id,
        client_name: nome.trim(),
        responsible: resp || null,
        monthly_investment: num(verba),
        cpa_target: num(cpa),
        client_since: since ? `${since}-01` : null,
        archived: false,
      });
      // entra nas "Contas exibidas" (no fim da lista), sem mexer nas outras
      const sel = (await fetch("/api/selected-accounts", { cache: "no-store" }).then((r) => r.json())) as { accountIds?: string[]; error?: string };
      if (sel.error) throw new Error(sel.error);
      const ids = (sel.accountIds ?? []).map(String);
      if (!ids.some((x) => normId(x) === id)) await send("/api/selected-accounts", "PUT", { accountIds: [...ids, id] });
      if (pay) await send("/api/pix-accounts", "PATCH", { ad_account_id: id, payment_type: pay });
      onCreated(id);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Novo cliente">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#121722]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Novo cliente</h2>
          <button onClick={onClose} aria-label="Fechar" className="h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">✕</button>
        </div>

        <Field label="Conta de anúncio (Meta)" htmlFor="nc-busca">
          {conta ? (
            <div className="flex h-10 items-center gap-2 rounded-lg border border-blue-600 bg-blue-600/10 px-3">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-blue-700 dark:text-blue-300">{conta.name}</span>
              <span className="font-mono text-[11px] text-zinc-500">{conta.account_id}</span>
              <Btn small onClick={() => setConta(null)}>Trocar</Btn>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  id="nc-busca"
                  autoFocus
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setCheckMsg(null);
                  }}
                  placeholder="Buscar pelo nome ou ID da conta…"
                  className={inputCls}
                />
                <Btn onClick={() => void loadAccounts(true)} disabled={refreshing} title="Busca de novo na Meta, sem esperar o cache">
                  {refreshing ? "…" : "↻ Atualizar lista"}
                </Btn>
              </div>
              {checkMsg ? <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{checkMsg}</p> : null}
              <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-white/10">
                {loadErr ? (
                  <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{loadErr}</p>
                ) : accounts == null || refreshing ? (
                  <p className="px-3 py-2 text-sm text-zinc-500">Carregando contas da Meta…</p>
                ) : lista.length === 0 ? (
                  <div className="flex flex-col gap-2 px-3 py-2 text-sm text-zinc-500">
                    <p>Nenhuma conta com &quot;{q.trim()}&quot; na lista da Meta.</p>
                    {idDigitado.length >= 6 ? (
                      <Btn small primary onClick={() => void verificarId()} disabled={checking}>
                        {checking ? "Verificando…" : `🔎 Verificar a conta ${idDigitado} direto na Meta`}
                      </Btn>
                    ) : (
                      <p className="text-xs">
                        Se a conta é nova, clique em <b>↻ Atualizar lista</b>. Ou cole o <b>ID da conta</b> (só números) pra verificar direto na Meta.
                      </p>
                    )}
                  </div>
                ) : (
                  lista.map((a) => {
                    const st = situacao[normId(a.account_id)];
                    return (
                      <button
                        key={a.id}
                        disabled={!!st}
                        onClick={() => escolher(a)}
                        title={st === "ativo" ? "Já está na carteira" : st === "arquivado" ? "Arquivado — traga de volta em Ver arquivados" : undefined}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-white/5"
                      >
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        {st ? <span className="text-[11px] text-zinc-500">{st === "ativo" ? "já é cliente" : "arquivado"}</span> : null}
                        <span className="font-mono text-[11px] text-zinc-400">{a.account_id}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </Field>

        {conta ? (
          <>
            <Field label="Nome do cliente" htmlFor="nc-nome">
              <input id="nc-nome" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Responsável" htmlFor="nc-resp">
              <select id="nc-resp" value={resp} onChange={(e) => setResp(e.target.value)} className={inputCls}>
                <option value="">Sem responsável</option>
                {gestores.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Verba mensal (R$)" htmlFor="nc-verba">
                <input id="nc-verba" inputMode="decimal" value={verba} onChange={(e) => setVerba(e.target.value)} placeholder="3000" className={inputCls} />
              </Field>
              <Field label="CPA ideal (R$)" htmlFor="nc-cpa">
                <input id="nc-cpa" inputMode="decimal" value={cpa} onChange={(e) => setCpa(e.target.value)} placeholder="7" className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pagamento" htmlFor="nc-pay">
                <select id="nc-pay" value={pay} onChange={(e) => setPay(e.target.value)} className={inputCls}>
                  <option value="">Não definido</option>
                  {Object.entries(payLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cliente desde" htmlFor="nc-since">
                <input id="nc-since" type="month" value={since} onChange={(e) => setSince(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              O resto (ofertas, grupo do WhatsApp) você completa depois na ficha e no WhatsApp do Hub.
            </p>
          </>
        ) : null}

        {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn primary onClick={() => void salvar()} disabled={!conta || saving}>{saving ? "Cadastrando…" : "Cadastrar cliente"}</Btn>
        </div>
      </div>
    </div>
  );
}
