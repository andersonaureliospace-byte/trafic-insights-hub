"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCacheTime, isFresh, readTabCache, writeTabCache } from "@/lib/client-cache";
import type { OffersSummary, OfferStatus } from "@/lib/offers/rule";

interface DescRow {
  ad_account_id: string;
  client_name: string | null;
  asana_task_gid: string | null;
  asana_task_name: string | null;
  asana_description: string;
  asana_has_rich: boolean;
  match_status: "ok" | "not_found" | "ambiguous" | "pending";
  draft: string | null;
  synced_at: string | null;
}

const ASANA_PROJECT_GID = "1208798639166829";

function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

const STATUS_CLASS: Record<OfferStatus, string> = {
  ATIVO: "text-emerald-600 dark:text-emerald-400",
  INATIVO: "text-amber-600 dark:text-amber-400",
  INEXISTENTE: "text-zinc-400 dark:text-zinc-500",
};

// Coluna "Ofertas ativas" (Etapa 149): GERAL / EXAME / PROMO / BOLETO do mês corrente, direto da Meta.
function OffersCell({ s }: { s: OffersSummary }) {
  const line = (label: string, status: OfferStatus, extra?: string | null) => (
    <p className="leading-5">
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}:</span>{" "}
      <span className={`font-semibold ${STATUS_CLASS[status]}`}>{status}</span>
      {extra ? <span className="text-zinc-600 dark:text-zinc-300"> - {extra}</span> : null}
    </p>
  );
  return (
    <div className="space-y-0.5 text-xs">
      {line("GERAL", s.geral)}
      {line("EXAME", s.exame.status, s.exame.status === "INEXISTENTE" ? null : s.exame.offer)}
      <p className="leading-5">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">PROMO:</span>{" "}
        {s.promo.length === 0 ? (
          <span className={`font-semibold ${STATUS_CLASS.INEXISTENTE}`}>INEXISTENTE</span>
        ) : (
          s.promo.map((p, i) => (
            <span key={p.offer}>
              {i > 0 ? <span className="text-zinc-400"> | </span> : null}
              <span className="text-zinc-700 dark:text-zinc-200">{p.offer}</span>{" "}
              <span className={`font-semibold ${p.active ? STATUS_CLASS.ATIVO : STATUS_CLASS.INATIVO}`}>
                ({p.active ? "ativa" : "inativa"})
              </span>
            </span>
          ))
        )}
      </p>
      {line("BOLETO", s.boleto)}
    </div>
  );
}

function sameText(a: string, b: string): boolean {
  const n = (x: string) => x.replace(/\r\n?/g, "\n").trimEnd();
  return n(a) === n(b);
}

// Aba Descrição (Etapa 115): a descrição de cada cliente vem do Asana (automático a cada 30 min em horário
// comercial, ou pelo botão "Atualizar do Asana"). Editou aqui? Fica como rascunho; só vai pro Asana
// quando você clica em "Enviar ao Asana" naquele cliente — e o texto SUBSTITUI a descrição de lá.
export function DescricaoTab({
  accounts,
  clientNames,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
}) {
  const [rows, setRows] = useState<Record<string, DescRow>>({});
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}); // texto digitado ainda não salvo como rascunho
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [query, setQuery] = useState("");
  // Ofertas ativas (Meta): guardadas no navegador por 1h; o ↻ da coluna busca de novo.
  const [offers, setOffers] = useState<Record<string, OffersSummary>>({});
  const [notIvs, setNotIvs] = useState<Set<string>>(new Set());
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offersAt, setOffersAt] = useState<number | null>(null);

  const accountIdsKey = accounts.map((a) => a.account_id).join(",");
  const loadOffers = useCallback(
    async (force: boolean) => {
      const ids = accountIdsKey ? accountIdsKey.split(",") : [];
      if (ids.length === 0) return;
      const cached = readTabCache<{ offers: Record<string, OffersSummary>; notIvs: string[] }>("descricao-ofertas");
      if (cached) {
        setOffers(cached.data.offers);
        setNotIvs(new Set(cached.data.notIvs));
        setOffersAt(cached.at);
        if (!force && isFresh(cached) && ids.every((id) => cached.data.offers[id] || cached.data.notIvs.includes(id))) return;
      }
      setOffersLoading(true);
      setOffersError(null);
      const acc: Record<string, OffersSummary> = {};
      const skip: string[] = [];
      const failed: string[] = [];
      try {
        for (let i = 0; i < ids.length; i += 6) {
          const res = await fetch("/api/analysis/offers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountIds: ids.slice(i, i + 6) }),
          });
          const d = await res.json();
          if (d.error) throw new Error(d.error);
          Object.assign(acc, d.offers ?? {});
          skip.push(...(d.notIvs ?? []));
          failed.push(...(d.failed ?? []));
          setOffers((prev) => ({ ...prev, ...(d.offers ?? {}) }));
          setNotIvs((prev) => new Set([...prev, ...(d.notIvs ?? [])]));
        }
        // Conta que falhou agora mantém o que já tinha guardado; o resto vira o novo backup.
        const merged = { ...(cached?.data.offers ?? {}), ...acc };
        setOffersAt(writeTabCache("descricao-ofertas", { offers: merged, notIvs: skip }));
        if (failed.length > 0) setOffersError(`${failed.length} conta(s) não carregaram (limite da Meta) — clique em ↻ pra tentar de novo.`);
      } catch (e) {
        setOffersError((e as Error).message);
      } finally {
        setOffersLoading(false);
      }
    },
    [accountIdsKey],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mostra o backup das ofertas e só busca na Meta se estiver velho
    void loadOffers(false);
  }, [loadOffers]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/asana/descriptions", { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      const map: Record<string, DescRow> = {};
      for (const r of (d.rows ?? []) as DescRow[]) map[r.ad_account_id] = r;
      setRows(map);
      setConfigured(Boolean(d.configured));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as descrições assim que a aba monta
    void load();
  }, [load]);

  const clients = useMemo(() => {
    const list = accounts
      .map((a) => ({ accountId: a.account_id, name: clientNames[a.account_id] || a.name || a.account_id }))
      .filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()));
    return list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [accounts, clientNames, query]);

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const d = await res.json();
      if (d.error) {
        setSyncMsg(d.error);
      } else {
        const s = d.summary as { configured: boolean; updated: string[]; notFound: string[]; ambiguous: string[]; errors: string[] };
        if (!s.configured) setSyncMsg("Asana não configurado (falta ASANA_ACCESS_TOKEN na Vercel).");
        else {
          const parts = [`${s.updated.length} atualizada(s) a partir do Asana`];
          if (s.notFound.length) parts.push(`sem tarefa com esse nome: ${s.notFound.join(", ")}`);
          if (s.ambiguous.length) parts.push(`mais de uma tarefa parecida: ${s.ambiguous.join(", ")}`);
          if (s.errors.length) parts.push(`erros: ${s.errors.join("; ")}`);
          setSyncMsg(parts.join(" · "));
        }
        await load();
      }
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  function currentText(accountId: string): string {
    if (edits[accountId] !== undefined) return edits[accountId];
    const r = rows[accountId];
    return r ? (r.draft ?? r.asana_description) : "";
  }

  async function saveDraft(accountId: string) {
    const r = rows[accountId];
    const typed = edits[accountId];
    if (!r || typed === undefined) return;
    const draft = sameText(typed, r.asana_description) ? null : typed;
    setBusy((b) => ({ ...b, [accountId]: true }));
    try {
      const res = await fetch("/api/asana/descriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: accountId, draft }),
      });
      const d = await res.json();
      if (d.error) {
        setRowMsg((m) => ({ ...m, [accountId]: { ok: false, text: d.error } }));
        return;
      }
      setRows((prev) => ({ ...prev, [accountId]: { ...prev[accountId], draft } }));
      setEdits((e) => {
        const next = { ...e };
        delete next[accountId];
        return next;
      });
    } finally {
      setBusy((b) => ({ ...b, [accountId]: false }));
    }
  }

  async function discard(accountId: string) {
    setEdits((e) => {
      const next = { ...e };
      delete next[accountId];
      return next;
    });
    setRowMsg((m) => ({ ...m, [accountId]: { ok: true, text: "" } }));
    const r = rows[accountId];
    if (r?.draft != null) {
      await fetch("/api/asana/descriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: accountId, draft: null }),
      });
      setRows((prev) => ({ ...prev, [accountId]: { ...prev[accountId], draft: null } }));
    }
  }

  async function send(accountId: string, force = false) {
    setBusy((b) => ({ ...b, [accountId]: true }));
    setRowMsg((m) => ({ ...m, [accountId]: { ok: true, text: "" } }));
    try {
      // Garante que o que está na caixa virou rascunho antes de enviar.
      if (edits[accountId] !== undefined) await saveDraft(accountId);
      const res = await fetch("/api/asana/descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", ad_account_id: accountId, force }),
      });
      const d = await res.json();
      if (d.error) {
        setRowMsg((m) => ({ ...m, [accountId]: { ok: false, text: d.error } }));
      } else if (d.ok) {
        setRowMsg((m) => ({ ...m, [accountId]: { ok: true, text: "Enviado ao Asana." } }));
        await load();
      } else if ((d.code === "conflict" || d.code === "rich") && !force) {
        if (confirm(`${d.message}\n\nEnviar mesmo assim?`)) {
          setBusy((b) => ({ ...b, [accountId]: false }));
          await send(accountId, true);
          return;
        }
      } else {
        setRowMsg((m) => ({ ...m, [accountId]: { ok: false, text: d.message ?? "Não foi possível enviar." } }));
      }
    } finally {
      setBusy((b) => ({ ...b, [accountId]: false }));
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Descrição</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente…"
            className="h-8 w-44 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
          />
          <button
            onClick={() => void syncNow()}
            disabled={syncing}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
          >
            {syncing ? "Atualizando…" : "↻ Atualizar do Asana"}
          </button>
        </div>
      </div>

      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        A descrição vem do Asana e é atualizada sozinha a cada 30 minutos em horário comercial (seg a sex, 08h às 18h).
        Se você editar aqui, o texto fica como rascunho e só vai para o Asana quando clicar em &quot;Enviar ao Asana&quot;
        no cliente — ele substitui a descrição de lá.
      </p>
      {!configured ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          O Asana ainda não está configurado: crie a variável ASANA_ACCESS_TOKEN na Vercel e faça um novo deploy.
        </p>
      ) : null}
      {offersError ? <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{offersError}</p> : null}
      {syncMsg ? <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-600 dark:border-zinc-800/60 dark:text-zinc-300">{syncMsg}</p> : null}
      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {!loaded && !error ? <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p> : null}

      {loaded ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="w-52 px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Descrição (Asana)</th>
                <th className="w-64 px-4 py-2 font-medium">
                  <span title="Conjuntos do mês corrente, direto da Meta: GERAL e BOLETO ativo/inativo/inexistente; EXAME com a oferta (uma só); PROMO com todas as ofertas">
                    Ofertas ativas
                  </span>{" "}
                  <button
                    onClick={() => void loadOffers(true)}
                    disabled={offersLoading}
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium normal-case text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    {offersLoading ? "…" : "↻"}
                  </button>
                  {offersAt && !offersLoading ? (
                    <span className="mt-0.5 block text-[10px] font-normal normal-case text-zinc-400">às {fmtCacheTime(offersAt)}</span>
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const r = rows[c.accountId];
                const text = currentText(c.accountId);
                const dirty = r ? !sameText(text, r.asana_description) : false;
                const linked = r?.match_status === "ok" && r.asana_task_gid;
                const msg = rowMsg[c.accountId];
                return (
                  <tr key={c.accountId} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</p>
                      {linked ? (
                        <a
                          href={`https://app.asana.com/0/${ASANA_PROJECT_GID}/${r.asana_task_gid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 block text-xs text-zinc-500 underline dark:text-zinc-400"
                        >
                          Abrir no Asana
                        </a>
                      ) : null}
                      <p className="mt-1 text-[11px] text-zinc-400">Sincronizado: {ago(r?.synced_at ?? null)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {!r ? (
                        <p className="text-xs text-zinc-500">Ainda não sincronizado — clique em &quot;Atualizar do Asana&quot;.</p>
                      ) : r.match_status === "not_found" ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Sem tarefa com esse nome no Asana. Ajuste o nome do cliente (ou da tarefa) e atualize.
                        </p>
                      ) : r.match_status === "ambiguous" ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Mais de uma tarefa parecida no Asana. Deixe o nome do cliente igual ao da tarefa e atualize.
                        </p>
                      ) : (
                        <>
                          <textarea
                            value={text}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [c.accountId]: e.target.value }))}
                            onBlur={() => void saveDraft(c.accountId)}
                            rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
                            className="w-full resize-y rounded-md border border-zinc-300 bg-transparent p-2 text-sm leading-relaxed dark:border-zinc-700"
                            placeholder="Sem descrição no Asana."
                          />
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => void send(c.accountId)}
                              disabled={!dirty || busy[c.accountId]}
                              className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                            >
                              {busy[c.accountId] ? "Enviando…" : "Enviar ao Asana"}
                            </button>
                            {dirty ? (
                              <button
                                onClick={() => void discard(c.accountId)}
                                className="h-7 rounded-md border border-zinc-300 px-2.5 text-xs font-medium dark:border-zinc-700"
                              >
                                Voltar ao do Asana
                              </button>
                            ) : null}
                            {dirty ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                alterado — ainda não enviado
                              </span>
                            ) : null}
                            {r.asana_has_rich ? (
                              <span className="text-[11px] text-zinc-400" title="A descrição no Asana tem negrito, lista ou link. Ao enviar como texto simples, isso se perde.">
                                tem formatação no Asana
                              </span>
                            ) : null}
                            {msg?.text ? (
                              <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>
                            ) : null}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {offers[c.accountId] ? (
                        <OffersCell s={offers[c.accountId]} />
                      ) : notIvs.has(c.accountId) ? (
                        <span className="text-xs text-zinc-400">Só contas IVS.</span>
                      ) : (
                        <span className="text-xs text-zinc-400">{offersLoading ? "Buscando na Meta…" : "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clients.length === 0 ? <p className="px-4 py-8 text-center text-sm text-zinc-500">Nenhum cliente encontrado.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
