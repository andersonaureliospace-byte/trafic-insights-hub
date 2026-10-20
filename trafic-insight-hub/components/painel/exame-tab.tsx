"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Etapa 163: Análise → Exame. Mostra quais contas PRECISAM de conjunto de EXAME e se têm algum ativo agora (conferido pelo nome do conjunto,
// só entre os anúncios ativos). A rotina automática roda 4x ao dia e avisa em Alertas; aqui dá pra ver o retrato, conferir na hora e dizer
// se cada conta precisa ou não de exame. Só leitura na Meta.

interface ExamAccount {
  accountId: string;
  clientName: string;
  explicit: boolean | null;
  required: boolean;
}
interface ExamStatus {
  accountId: string;
  examAdsets: string[];
  checkedAt: string;
  error?: string;
}

type Filter = "todas" | "sem" | "com" | "nao";
const BATCH = 5;

function atTxt(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", " às");
}

// "EXAME | R$ 49,99 | 8KM | 35-54 | MULHER | AND | 19/10" → "R$ 49,99 · 8KM · 35-54 · MULHER"
function shortName(name: string): string {
  return name
    .split("|")
    .map((p) => p.trim())
    .filter((p, i) => i > 0 && p && !/^(AND|ANDERSON)$/i.test(p) && !/^\d{1,2}\/\d{1,2}$/.test(p))
    .join(" · ") || name;
}

export function ExameTab() {
  const [accounts, setAccounts] = useState<ExamAccount[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ExamStatus>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("sem");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/exam");
      const d = (await res.json()) as { error?: string; accounts?: ExamAccount[]; statuses?: Record<string, ExamStatus> };
      if (d.error) throw new Error(d.error);
      setAccounts(d.accounts ?? []);
      setStatuses(d.statuses ?? {});
    } catch (e) {
      setError((e as Error).message);
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o retrato guardado ao abrir a subseção
    void read();
  }, [read]);

  const check = useCallback(async (ids: string[], withProgress: boolean) => {
    if (ids.length === 0) return;
    setError(null);
    if (withProgress) {
      setLoading(true);
      setProgress({ done: 0, total: ids.length });
    }
    for (let i = 0; i < ids.length; i += BATCH) {
      try {
        const res = await fetch("/api/analysis/exam", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: ids.slice(i, i + BATCH) }),
        });
        const d = (await res.json()) as { error?: string; statuses?: ExamStatus[] };
        if (d.error) throw new Error(d.error);
        setStatuses((prev) => {
          const next = { ...prev };
          for (const s of d.statuses ?? []) next[s.accountId] = s;
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
      }
      if (withProgress) setProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
    }
    if (withProgress) {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  async function setRequirement(a: ExamAccount, value: boolean | null) {
    setBusy(a.accountId);
    setError(null);
    try {
      const res = await fetch("/api/analysis/exam", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: a.accountId, needsExam: value }),
      });
      const d = (await res.json()) as { error?: string };
      if (d.error) throw new Error(d.error);
      await read();
      if (value === true && !statuses[a.accountId]) await check([a.accountId], false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  const rows = useMemo(() => {
    return (accounts ?? []).map((a) => {
      const st = statuses[a.accountId];
      const state: "nao" | "pendente" | "erro" | "sem" | "com" = !a.required ? "nao" : !st ? "pendente" : st.error ? "erro" : st.examAdsets.length === 0 ? "sem" : "com";
      return { a, st, state };
    });
  }, [accounts, statuses]);

  const counts = useMemo(() => {
    const c = { todas: rows.length, sem: 0, com: 0, nao: 0 };
    for (const r of rows) {
      if (r.state === "sem") c.sem++;
      else if (r.state === "com") c.com++;
      else if (r.state === "nao") c.nao++;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "todas" || r.state === filter) && (!needle || r.a.clientName.toLowerCase().includes(needle)))
      .sort((x, y) => {
        const w = (s: string) => (s === "sem" ? 0 : s === "erro" ? 1 : s === "pendente" ? 2 : s === "com" ? 3 : 4);
        return w(x.state) - w(y.state) || x.a.clientName.localeCompare(y.a.clientName, "pt-BR");
      });
  }, [rows, filter, q]);

  const newest = useMemo(() => Object.values(statuses).map((s) => s.checkedAt).sort().at(-1) ?? null, [statuses]);
  const toCheck = useMemo(() => rows.filter((r) => r.a.required).map((r) => r.a.accountId), [rows]);

  const FILTERS: Array<{ id: Filter; label: string; n: number }> = [
    { id: "sem", label: "Sem exame ativo", n: counts.sem },
    { id: "com", label: "Com exame ativo", n: counts.com },
    { id: "nao", label: "Não precisa de exame", n: counts.nao },
    { id: "todas", label: "Todas", n: counts.todas },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Exame</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Contas que precisam de um conjunto de EXAME ativo (pelo nome do conjunto, só anúncios ativos). Conferido 4x ao dia (09h05, 12h05, 15h05 e 18h05) — sem exame, o aviso cai em Alertas.
            {newest ? ` Última conferência: ${atTxt(newest)}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conta"
            className="h-8 w-48 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={() => void check(toCheck, true).then(read)}
            disabled={loading || toCheck.length === 0}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading && progress ? `Conferindo… ${progress.done}/${progress.total}` : "↻ Conferir agora"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800/60">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`h-7 rounded-full px-2.5 text-xs font-medium ${
              filter === f.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {f.label} ({f.n})
          </button>
        ))}
      </div>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {!accounts ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
          {filter === "sem" ? "Nenhuma conta sem exame ativo no último retrato." : "Nenhuma conta nessa situação."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-1.5 font-medium">Conta</th>
                <th className="px-4 py-1.5 font-medium">Precisa de exame?</th>
                <th className="px-4 py-1.5 font-medium">Situação</th>
                <th className="px-4 py-1.5 font-medium">Conjuntos de exame ativos</th>
                <th className="px-4 py-1.5 text-right font-medium">Conferido</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ a, st, state }) => (
                <tr key={a.accountId} className="border-t border-zinc-100 align-top dark:border-zinc-800/60">
                  <td className="px-4 py-2 font-medium">{a.clientName}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
                        {([
                          [true, "Sim"],
                          [false, "Não"],
                        ] as const).map(([v, label]) => (
                          <button
                            key={label}
                            disabled={busy === a.accountId}
                            onClick={() => void setRequirement(a, a.required === v && a.explicit === v ? null : v)}
                            title={a.required === v && a.explicit === v ? "Clique de novo para voltar ao padrão" : undefined}
                            className={`rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                              a.required === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {a.explicit === null ? <span className="text-xs text-zinc-400">padrão</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {state === "sem" ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">Sem exame ativo</span>
                    ) : state === "com" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        {st?.examAdsets.length} conjunto{st?.examAdsets.length === 1 ? "" : "s"} ativo{st?.examAdsets.length === 1 ? "" : "s"}
                      </span>
                    ) : state === "erro" ? (
                      <span title={st?.error} className="text-xs text-amber-600">erro ao conferir</span>
                    ) : state === "pendente" ? (
                      <span className="text-xs text-zinc-400">ainda não conferido</span>
                    ) : (
                      <span className="text-xs text-zinc-400">não precisa</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                    {st && a.required && st.examAdsets.length > 0 ? (
                      <ul className="space-y-0.5">
                        {st.examAdsets.slice(0, 3).map((n) => (
                          <li key={n} title={n}>
                            {shortName(n)}
                          </li>
                        ))}
                        {st.examAdsets.length > 3 ? <li className="text-zinc-400">+{st.examAdsets.length - 3}</li> : null}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-zinc-500 dark:text-zinc-400">{st ? atTxt(st.checkedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Conta com “padrão” precisa de exame se for IVS; clique em Sim/Não para definir (clique de novo na opção marcada para voltar ao padrão). Conjunto de EXAME = nome do conjunto começando com EXAME
        (boleto/crediário não conta; campanha [VAGA] fica de fora). Só valem anúncios ativos — o conjunto e a campanha também precisam estar ligados.
      </p>
    </div>
  );
}
