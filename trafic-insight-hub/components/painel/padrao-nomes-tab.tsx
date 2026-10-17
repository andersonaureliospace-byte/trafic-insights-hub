"use client";

import { useMemo, useState } from "react";

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
  const [account, setAccount] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [autoBusy, setAutoBusy] = useState(false);

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
      setEdits({});
      setItemErrors({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function accept(it: Item) {
    const name = (edits[it.id] ?? it.suggestion ?? "").trim();
    if (!name) return;
    setBusyIds((s) => new Set(s).add(it.id));
    setItemErrors((m) => {
      const { [it.id]: _drop, ...rest } = m;
      return rest;
    });
    try {
      const res = await fetch("/api/naming/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, name }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha ao renomear.");
      setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
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

  async function runAutoFix() {
    setAutoBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/naming/autofix", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Falha no ajuste automático.");
      setMsg(`Ajustados: ${j.fixed} conjunto(s)${j.failed > 0 ? ` · falharam: ${j.failed}` : ""}.`);
      await scan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  const auto = useMemo(() => (items ?? []).filter((i) => i.autoFix), [items]);
  const manual = useMemo(() => (items ?? []).filter((i) => !i.autoFix), [items]);
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
          <p>Só contas IVS, só itens ativos. &quot;Cópia&quot; não pode aparecer em nenhum nome.</p>
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
            disabled={loading || autoBusy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading ? "Verificando…" : items == null ? "Verificar agora" : "Verificar de novo"}
          </button>
          {auto.length > 0 ? (
            <button
              onClick={() => void runAutoFix()}
              disabled={loading || autoBusy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Só a idade e/ou a data estão diferentes — dados que vêm direto da Meta, não precisa de aprovação"
            >
              {autoBusy ? "Ajustando…" : `Ajustar idade/data de ${auto.length} conjunto(s) agora`}
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
              {auto.length} conjunto(s) só com idade/data diferentes — o sistema ajusta sozinho todo dia (ou use o botão acima).
            </p>
          ) : null}
          {byAccount.map(([name, list]) => (
            <section key={name}>
              <h3 className="bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
                {name} ({list.length})
              </h3>
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
                      </div>
                      <p className="text-xs text-amber-700 dark:text-amber-400">{it.problems.join(" · ")}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={value}
                          onChange={(e) => setEdits((m) => ({ ...m, [it.id]: e.target.value }))}
                          className="min-w-[16rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <button
                          onClick={() => void accept(it)}
                          disabled={blocked}
                          title={it.needsInput && !edited ? "A sugestão está incompleta — edite antes de aceitar" : undefined}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          {busyIds.has(it.id) ? "Renomeando…" : edited ? "Aceitar (editado)" : "Aceitar"}
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
    </div>
  );
}
