"use client";

import { useMemo, useState } from "react";
import { adsManagerEntityUrl } from "@/lib/meta/ads-manager-link";

// Etapa 140: aba "Padrão de nomes". Varre as contas IVS (campanhas, conjuntos e anúncios ATIVOS) e lista só o que está fora do padrão,
// com uma sugestão. Aceitar = renomeia na hora na Meta; dá pra editar a sugestão antes de aceitar. Idade e data (quando são as únicas
// divergências) o sistema ajusta sozinho todo dia — aqui há um botão pra rodar isso na hora.

type Entity = "campaign" | "adset" | "ad";

interface Item {
  entity: Entity;
  id: string;
  ad_account_id: string;
  client_name: string;
  current_name: string;
  suggestion: string | null;
  problems: string[];
  needsInput: boolean;
  autoFix: boolean;
  autoName?: string | null;
}

// Etapa 192: "auto" = o ajuste automático resolve tudo (idade/data e/ou "Cópia"). Quem tem mais coisa fora do padrão
// fica na lista de aprovação (o automático só tira o "Cópia" e acerta a data dele; o resto continua aqui).
const fullyAuto = (i: Item) => i.autoFix && !!i.autoName && i.autoName === i.suggestion;

interface Kept {
  entity_id: string;
  entity: Entity;
  ad_account_id: string | null;
  client_name: string | null;
  name: string | null;
}

const ENTITY_LABEL: Record<Entity, string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };

const PATTERN_HELP = [
  "Campanha: TIPO | OBJETIVO | UNIDADE (TIPO = GERAL, EXAME ou OFERTA)",
  "Conjunto: TIPO | OFERTA | LOCALIZAÇÃO OU KM | IDADE | GÊNERO | PLATAFORMA | DIRECIONAMENTO | AND | DATA",
];

export function PadraoNomesTab() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [accounts, setAccounts] = useState<Array<{ ad_account_id: string; client_name: string }>>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [kept, setKept] = useState<Kept[]>([]);
  const [showKept, setShowKept] = useState(false);
  const [account, setAccount] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  async function scan() {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const qs = account !== "all" ? `?account=${encodeURIComponent(account)}` : "";
      const res = await fetch(`/api/naming/check${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Falha na verificação.");
      setItems(j.items ?? []);
      setAccounts(j.accounts ?? []);
      setFailed(j.failedAccounts ?? []);
      setKept(j.kept ?? []);
      setEdits({});
      setItemErrors({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Renomeia um item (usa o texto editado, se houver). Devolve true se deu certo.
  async function renameOne(it: Item): Promise<boolean> {
    const name = (edits[it.id] ?? it.suggestion ?? "").trim();
    if (!name) return false;
    setBusyIds((s) => new Set(s).add(it.id));
    setItemErrors((m) => {
      const { [it.id]: _drop, ...rest } = m;
      return rest;
    });
    try {
      const res = await fetch("/api/naming/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: it.id,
          name,
          entity: it.entity,
          ad_account_id: it.ad_account_id,
          client_name: it.client_name,
          edited: edits[it.id] != null && edits[it.id] !== it.suggestion,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha ao renomear.");
      setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
      if (j.locked) {
        setKept((k) => [...k, { entity_id: it.id, entity: it.entity, ad_account_id: it.ad_account_id, client_name: it.client_name, name }]);
        setMsg("Renomeado e guardado como personalizado — esse item não volta pra lista (você pode desfazer em \"Personalizados\").");
      }
      return true;
    } catch (e) {
      setItemErrors((m) => ({ ...m, [it.id]: (e as Error).message }));
      return false;
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(it.id);
        return n;
      });
    }
  }

  // "Manter personalizado": não renomeia, só avisa o sistema pra nunca mais mexer nesse nome (nem no ajuste automático).
  async function keepOne(it: Item) {
    setBusyIds((s) => new Set(s).add(it.id));
    try {
      const res = await fetch("/api/naming/keep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "keep",
          id: it.id,
          entity: it.entity,
          ad_account_id: it.ad_account_id,
          client_name: it.client_name,
          name: it.current_name,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha ao guardar.");
      setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
      setKept((k) => [...k, { entity_id: it.id, entity: it.entity, ad_account_id: it.ad_account_id, client_name: it.client_name, name: it.current_name }]);
    } catch (e) {
      setItemErrors((m) => ({ ...m, [it.id]: (e as Error).message }));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(it.id);
        return n;
      });
    }
  }

  async function releaseOne(k: Kept) {
    try {
      const res = await fetch("/api/naming/keep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", id: k.entity_id }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha.");
      setKept((cur) => cur.filter((x) => x.entity_id !== k.entity_id));
      setMsg("Voltou ao padrão — clique em \"Verificar de novo\" para ele aparecer na lista, se estiver fora da regra.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Item com sugestão incompleta só entra no "aceitar todos" se você já editou o texto.
  function canAccept(it: Item): boolean {
    const edited = edits[it.id] != null && edits[it.id] !== it.suggestion;
    return !!(edits[it.id] ?? it.suggestion ?? "").trim() && (!it.needsInput || edited);
  }

  async function acceptMany(list: Item[], label: string) {
    const todo = list.filter(canAccept);
    if (todo.length === 0) return;
    const skipped = list.length - todo.length;
    if (
      !window.confirm(
        `Renomear ${todo.length} item(ns) na Meta (${label})?${skipped > 0 ? `\n${skipped} com sugestão incompleta ficam de fora.` : ""}`,
      )
    )
      return;
    setMsg(null);
    setBulk({ done: 0, total: todo.length });
    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      if (await renameOne(todo[i])) ok++;
      setBulk({ done: i + 1, total: todo.length });
      if (i < todo.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
    setBulk(null);
    setMsg(`Renomeados: ${ok} de ${todo.length}${ok < todo.length ? " — os que falharam ficaram na lista com o motivo" : ""}.`);
  }

  async function runAutoFix() {
    setAutoBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/naming/autofix", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha no ajuste automático.");
      setMsg(`Ajustados: ${j.fixed} item(ns)${j.failed > 0 ? ` · falharam: ${j.failed}` : ""}.`);
      await scan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  const auto = useMemo(() => (items ?? []).filter(fullyAuto), [items]);
  const manual = useMemo(() => (items ?? []).filter((i) => !fullyAuto(i)), [items]);
  const byAccount = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of manual) {
      const list = m.get(it.client_name) ?? [];
      list.push(it);
      m.set(it.client_name, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [manual]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="space-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="text-xs text-zinc-500">
          {PATTERN_HELP.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p>Só contas IVS, só itens ligados (ativos ou programados). &quot;Cópia&quot; não pode aparecer em nenhum nome.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">Todas as contas IVS</option>
            {accounts.map((a) => (
              <option key={a.ad_account_id} value={a.ad_account_id}>
                {a.client_name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void scan()}
            disabled={loading || autoBusy || bulk != null}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading ? "Verificando…" : items == null ? "Verificar agora" : "Verificar de novo"}
          </button>
          {auto.length > 0 ? (
            <button
              onClick={() => void runAutoFix()}
              disabled={loading || autoBusy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              title='Idade/data diferentes (dados que vêm direto da Meta) e/ou "Cópia" no nome — não precisa de aprovação. Nos que precisam de aprovação no resto, também tira o "Cópia" e acerta a data.'
            >
              {autoBusy ? "Ajustando…" : `Ajustar automáticos (${auto.length}) agora`}
            </button>
          ) : null}
          {manual.length > 0 ? (
            <button
              onClick={() => void acceptMany(manual, "todas as contas")}
              disabled={loading || autoBusy || bulk != null || manual.filter(canAccept).length === 0}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {bulk ? `Renomeando ${bulk.done}/${bulk.total}…` : `Aceitar todos (${manual.filter(canAccept).length})`}
            </button>
          ) : null}
        </div>
        {msg ? <p className="text-xs text-emerald-600">{msg}</p> : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {failed.length > 0 ? <p className="text-xs text-amber-600">Não consegui ler: {failed.join(", ")}.</p> : null}
      </div>

      {items == null ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Clique em &quot;Verificar agora&quot; para listar o que está fora do padrão.</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-emerald-600">Tudo dentro do padrão. 🎉</p>
      ) : (
        <>
          {auto.length > 0 ? (
            <p className="bg-emerald-50 px-4 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {auto.length} item(ns) só com idade/data diferentes e/ou &quot;Cópia&quot; no nome — o sistema ajusta sozinho (ou use o botão acima).
            </p>
          ) : null}
          {byAccount.map(([name, list]) => (
            <section key={name}>
              <div className="flex items-center justify-between gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-950">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {name} ({list.length})
                </h3>
                <button
                  onClick={() => void acceptMany(list, name)}
                  disabled={loading || autoBusy || bulk != null || list.filter(canAccept).length === 0}
                  className="rounded border border-emerald-600 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  Aceitar todos desta conta ({list.filter(canAccept).length})
                </button>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {list.map((it) => {
                  const value = edits[it.id] ?? it.suggestion ?? "";
                  const edited = edits[it.id] != null && edits[it.id] !== it.suggestion;
                  const blocked = busyIds.has(it.id) || !value.trim() || (it.needsInput && !edited);
                  return (
                    <li key={it.id} className="space-y-1.5 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {ENTITY_LABEL[it.entity]}
                        </span>
                        <span className="break-all text-zinc-500 line-through decoration-zinc-300">{it.current_name}</span>
                        <a
                          href={adsManagerEntityUrl(it.ad_account_id, it.entity, it.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="whitespace-nowrap text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Abrir no Gerenciador ↗
                        </a>
                      </div>
                      <p className="text-xs text-amber-700 dark:text-amber-400">{it.problems.join(" · ")}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={value}
                          onChange={(e) => setEdits((m) => ({ ...m, [it.id]: e.target.value }))}
                          className="min-w-[16rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <button
                          onClick={() => void renameOne(it)}
                          disabled={blocked || bulk != null}
                          title={it.needsInput && !edited ? "A sugestão está incompleta — edite antes de aceitar" : undefined}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          {busyIds.has(it.id) ? "Renomeando…" : edited ? "Aceitar (editado)" : "Aceitar"}
                        </button>
                        <button
                          onClick={() => void keepOne(it)}
                          disabled={busyIds.has(it.id) || bulk != null}
                          title="Esse nome é personalizado de propósito: não renomeia e o sistema nunca mais mexe nele"
                          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Manter personalizado
                        </button>
                      </div>
                      {it.needsInput && !edited ? <p className="text-xs text-zinc-400">Sugestão incompleta: edite o que falta e aceite.</p> : null}
                      {itemErrors[it.id] ? <p className="text-xs text-red-600">{itemErrors[it.id]}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {kept.length > 0 ? (
        <section className="border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowKept((v) => !v)}
            className="w-full bg-zinc-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            Personalizados ({kept.length}) {showKept ? "▲" : "▼"}
          </button>
          {showKept ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {kept.map((k) => (
                <li key={k.entity_id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {ENTITY_LABEL[k.entity]}
                  </span>
                  <span className="min-w-0 flex-1 break-all text-zinc-700 dark:text-zinc-200">
                    {k.name ?? k.entity_id}
                    {k.client_name ? <span className="ml-2 text-xs text-zinc-400">{k.client_name}</span> : null}
                  </span>
                  <button
                    onClick={() => void releaseOne(k)}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Voltar ao padrão
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
