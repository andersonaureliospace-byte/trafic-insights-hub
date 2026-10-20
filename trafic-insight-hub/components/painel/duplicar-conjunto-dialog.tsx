"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import { isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";
import { adsManagerEntityUrl } from "@/lib/meta/ads-manager-link";

// Etapa 159: janelinha "Duplicar conjunto" (Análise > CPA abaixo da meta). Mostra os criativos ATIVOS do conjunto com o CPA de cada um
// (os acima da meta já vêm desmarcados), o nome sugerido (data de hoje no lugar da antiga) e o orçamento diário. A cópia nasce PAUSADA.

export interface DuplicateAdsetInput {
  id: string;
  name: string;
  accountId: string;
  cpaTarget: number;
  ads: Array<{ id: string; spend: number; conversations: number | null; cost_per_conversation: number | null }>;
}

interface Info {
  adsetName: string;
  suggestedName: string;
  dailyBudget: number | null;
  budgetNote: string | null;
  ads: Array<{ id: string; name: string; status: string }>;
}

interface Result {
  ok: boolean;
  newAdsetId?: string;
  newName?: string;
  copiedAds: Array<{ sourceId: string; newId: string | null }>;
  failedAds: Array<{ id: string; name: string; error: string }>;
  warnings: string[];
  notes?: string[];
  error?: string;
}

export function DuplicarConjuntoDialog({ adset, onClose }: { adset: DuplicateAdsetInput; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const statsById = useMemo(() => new Map(adset.ads.map((a) => [a.id, a])), [adset.ads]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/analysis/duplicate?adsetId=${encodeURIComponent(adset.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Info & { error?: string }) => {
        if (!alive) return;
        if (d.error) {
          setLoadError(d.error);
          return;
        }
        setInfo(d);
        setName(d.suggestedName);
        setBudget(d.dailyBudget != null ? String(d.dailyBudget).replace(".", ",") : "");
        // Criativos acima da meta (R$4+) já vêm desmarcados.
        setSelected(
          new Set(
            d.ads
              .filter((a) => {
                const st = statsById.get(a.id);
                return !(st && isCreativeFlaggedAbove(st as Parameters<typeof isCreativeFlaggedAbove>[0], adset.cpaTarget));
              })
              .map((a) => a.id),
          ),
        );
      })
      .catch(() => alive && setLoadError("Não consegui carregar os dados do conjunto."));
    return () => {
      alive = false;
    };
  }, [adset.id, adset.cpaTarget, statsById]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!info) return;
    setSubmitting(true);
    setResult(null);
    const budgetNum = budget.trim() ? Number(budget.replace(",", ".")) : null;
    try {
      const res = await fetch("/api/analysis/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adsetId: adset.id,
          name,
          ads: info.ads.filter((a) => selected.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
          dailyBudget: info.dailyBudget != null && budgetNum != null && Number.isFinite(budgetNum) && budgetNum !== info.dailyBudget ? budgetNum : null,
        }),
      });
      const d = (await res.json()) as Result;
      setResult({ ...d, ok: !!d.ok, copiedAds: d.copiedAds ?? [], failedAds: d.failedAds ?? [], warnings: d.warnings ?? [] });
    } catch {
      setResult({ ok: false, copiedAds: [], failedAds: [], warnings: [], error: "Sem resposta do servidor (pode ter dado tempo esgotado). Confira no Gerenciador se a cópia foi criada." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Duplicar conjunto</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400" title={adset.name}>
              {adset.name}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            ✕
          </button>
        </div>

        {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
        {!info && !loadError ? <p className="text-sm text-zinc-500">Carregando…</p> : null}

        {info && !result ? (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Nome do conjunto novo</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-xs text-zinc-500">A data do nome já veio trocada pela de hoje.</span>
            </label>

            {info.dailyBudget != null ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Orçamento diário (R$)</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                  className="h-9 w-40 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="text-xs text-zinc-500">Orçamento do original: {fmtCurrency(info.dailyBudget)}.</span>
              </label>
            ) : (
              <p className="text-xs text-zinc-500">{info.budgetNote}</p>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Criativos que vão pra cópia ({selected.size} de {info.ads.length})
              </span>
              {info.ads.length === 0 ? (
                <p className="text-sm text-zinc-500">Esse conjunto não tem criativo ativo.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
                  {info.ads.map((a) => {
                    const st = statsById.get(a.id);
                    const flagged = !!st && isCreativeFlaggedAbove(st as Parameters<typeof isCreativeFlaggedAbove>[0], adset.cpaTarget);
                    return (
                      <label key={a.id} className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800">
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                        <span className="min-w-0 flex-1 truncate" title={a.name}>
                          {a.name}
                        </span>
                        <span className="whitespace-nowrap text-xs tabular-nums text-zinc-500">
                          {st ? (st.conversations && st.conversations > 0 ? `${fmtCurrency(st.cost_per_conversation)}/conv · ${st.conversations} conv` : `sem conversa · ${fmtCurrency(st.spend)}`) : "sem dados no período"}
                        </span>
                        {flagged ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">acima da meta</span> : null}
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-zinc-500">Só criativos ativos aparecem. A cópia nasce pausada: confira no Gerenciador e ative.</p>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="h-9 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700">
                Cancelar
              </button>
              <button
                onClick={() => void submit()}
                disabled={submitting || !name.trim() || selected.size === 0}
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {submitting ? "Duplicando… (pode levar alguns segundos)" : "Duplicar (pausado)"}
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            {result.error ? (
              <p className="rounded-md bg-red-50 p-3 text-red-700 dark:bg-red-950/40 dark:text-red-300">{result.error}</p>
            ) : (
              <p className="rounded-md bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                Conjunto criado (pausado){result.newName ? `: ${result.newName}` : ""}. {result.copiedAds.length} criativo(s) copiado(s)
                {result.failedAds.length > 0 ? `, ${result.failedAds.length} com erro` : ""}.
              </p>
            )}
            {result.failedAds.map((f) => (
              <p key={f.id} className="rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                <b>{f.name}</b>: {f.error}
              </p>
            ))}
            {(result.notes ?? []).length > 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{(result.notes ?? []).join(" ")}</p>
            ) : null}
            {result.warnings.map((w, i) => (
              <p key={i} className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {w}
              </p>
            ))}
            <div className="flex justify-end gap-2">
              {result.newAdsetId ? (
                <a
                  href={adsManagerEntityUrl(adset.accountId, "adset", result.newAdsetId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700"
                >
                  Abrir no Gerenciador
                </a>
              ) : null}
              <button onClick={onClose} className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                Fechar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
