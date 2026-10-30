"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import type { AccountInsight } from "@/lib/meta/insights";
import { budgetReference, computeSpeed } from "@/lib/meta/speed";
import { monthCalendarSP } from "@/lib/meta/ritmo";
import { brtIso, nowLocal, suggestName, tomorrow5 } from "@/components/painel/duplicar-conjunto-dialog";

// Etapa 234: editor em massa — vários conjuntos modelo, N cópias de cada, e em cada cópia: nome, idade, orçamento e cada
// criativo Ativo / Pausado / Fora. "Enviar" cria tudo (pausado), confere o WhatsApp lendo de volta e, se pedido, ativa.
// Em cima: investimento diário atual da conta × Ritmo (gastar hoje até 17h, gastar amanhã depois) e como fica com as cópias.

type AdChoice = "ACTIVE" | "PAUSED" | "OFF";
interface ModelAd {
  id: string;
  name: string;
  status: string;
}
interface ModelInfo {
  adsetName: string;
  dailyBudget: number | null;
  budgetNote: string | null;
  ageMin: number | null;
  ageMax: number | null;
  whatsapp: string | null;
  ads: ModelAd[];
}
interface CopyDraft {
  key: string;
  name: string;
  nameTouched: boolean;
  ageMin: string;
  ageMax: string;
  budget: string;
  ads: Record<string, AdChoice>;
}
interface CopyResult {
  ok: boolean;
  text: string;
  warn?: string[];
}

const CHOICE_NEXT: Record<AdChoice, AdChoice> = { ACTIVE: "PAUSED", PAUSED: "OFF", OFF: "ACTIVE" };
const CHOICE_CLS: Record<AdChoice, string> = {
  ACTIVE: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PAUSED: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  OFF: "border-dashed border-zinc-300 text-zinc-400 line-through dark:border-zinc-700",
};
const CHOICE_LABEL: Record<AdChoice, string> = { ACTIVE: "ativo", PAUSED: "pausado", OFF: "fora" };
const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export function EditorMassa({
  accountId,
  accountName,
  models,
  onClose,
  onDone,
}: {
  accountId: string;
  accountName: string;
  models: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [infos, setInfos] = useState<Record<string, ModelInfo | { error: string }>>({});
  const [copies, setCopies] = useState<Record<string, CopyDraft[]>>({});
  const [startMode, setStartMode] = useState<"tomorrow" | "now" | "custom">("tomorrow");
  const [customStart, setCustomStart] = useState(tomorrow5());
  const [activate, setActivate] = useState(true);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, CopyResult | "running">>({});
  // Ritmo da conta
  const [ins, setIns] = useState<AccountInsight | null>(null);
  const [untilY, setUntilY] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [cpaTarget, setCpaTarget] = useState<number | null>(null);
  const [ritmoErr, setRitmoErr] = useState<string | null>(null);

  const startLocal = startMode === "tomorrow" ? tomorrow5() : startMode === "now" ? nowLocal() : customStart;

  // Dados de cada modelo (criativos, idade, orçamento, WhatsApp) — 2 por vez.
  useEffect(() => {
    let alive = true;
    const queue = [...models];
    const work = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const d = (await fetch(`/api/analysis/duplicate?adsetId=${encodeURIComponent(m.id)}`, { cache: "no-store" }).then((r) => r.json())) as ModelInfo & {
            error?: string;
          };
          if (!alive) return;
          if (d.error) {
            setInfos((x) => ({ ...x, [m!.id]: { error: d.error as string } }));
            continue;
          }
          setInfos((x) => ({ ...x, [m!.id]: d }));
          setCopies((x) => (x[m!.id] ? x : { ...x, [m!.id]: [newCopy(d, 0)] }));
        } catch (e) {
          if (alive) setInfos((x) => ({ ...x, [m!.id]: { error: (e as Error).message } }));
        }
      }
    };
    void Promise.all([work(), work()]);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega uma vez ao abrir
  }, []);

  // Ritmo: gasto do mês (com orçamento diário atual), gasto até ontem e meta mensal / CPA ideal cadastrados.
  useEffect(() => {
    let alive = true;
    const firstDay = monthCalendarSP().day === 1;
    const post = (body: Record<string, unknown>) =>
      fetch("/api/meta/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountIds: [accountId], ...body }) }).then(
        (r) => r.json() as Promise<{ insights?: Record<string, AccountInsight>; error?: string }>,
      );
    Promise.all([
      post({ datePreset: "this_month" }),
      firstDay ? Promise.resolve(null) : post({ datePreset: "this_month_until_yesterday", spendOnly: true }).catch(() => null),
      fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json() as Promise<{ bindings?: Array<{ ad_account_id: string; monthly_investment?: number | null; cpa_target?: number | null }> }>),
    ])
      .then(([m, y, b]) => {
        if (!alive) return;
        const i = m.insights?.[accountId] ?? null;
        if (!i || i.insights_failed) setRitmoErr(m.error ?? "A Meta não devolveu o gasto do mês.");
        setIns(i);
        const yi = y?.insights?.[accountId];
        setUntilY(firstDay ? 0 : yi && !yi.insights_failed ? yi.spend : null);
        const bb = b.bindings?.find((x) => x.ad_account_id === accountId);
        setMonthly(bb?.monthly_investment ?? null);
        setCpaTarget(bb?.cpa_target ?? null);
      })
      .catch((e: Error) => alive && setRitmoErr(e.message));
    return () => {
      alive = false;
    };
  }, [accountId]);

  function newCopy(d: ModelInfo, i: number): CopyDraft {
    const ads: Record<string, AdChoice> = {};
    for (const a of d.ads) ads[a.id] = a.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
    const min = d.ageMin != null ? String(d.ageMin) : "";
    const max = d.ageMax != null ? String(d.ageMax) : "";
    return {
      key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name: suggestName(d.adsetName, startLocal, d.ageMin, d.ageMax),
      nameTouched: false,
      ageMin: min,
      ageMax: max,
      budget: d.dailyBudget != null ? String(d.dailyBudget).replace(".", ",") : "",
      ads,
    };
  }

  // Nome sugerido acompanha início e idade (até editar à mão).
  useEffect(() => {
    setCopies((all) => {
      const out: Record<string, CopyDraft[]> = {};
      for (const [mid, list] of Object.entries(all)) {
        const info = infos[mid];
        out[mid] =
          info && !("error" in info)
            ? list.map((c) => (c.nameTouched ? c : { ...c, name: suggestName(info.adsetName, startLocal, num(c.ageMin), num(c.ageMax)) }))
            : list;
      }
      return out;
    });
  }, [startLocal, infos]);

  function setCount(mid: string, n: number) {
    const info = infos[mid];
    if (!info || "error" in info) return;
    setCopies((all) => {
      const cur = all[mid] ?? [];
      const target = Math.max(0, Math.min(10, n));
      if (target <= cur.length) return { ...all, [mid]: cur.slice(0, target) };
      const add = Array.from({ length: target - cur.length }, (_, i) => newCopy(info, cur.length + i));
      return { ...all, [mid]: [...cur, ...add] };
    });
  }
  function patch(mid: string, key: string, p: Partial<CopyDraft>) {
    setCopies((all) => ({ ...all, [mid]: (all[mid] ?? []).map((c) => (c.key === key ? { ...c, ...p } : c)) }));
  }
  function patchAge(mid: string, key: string, field: "ageMin" | "ageMax", v: string) {
    const info = infos[mid];
    setCopies((all) => ({
      ...all,
      [mid]: (all[mid] ?? []).map((c) => {
        if (c.key !== key) return c;
        const next = { ...c, [field]: v.replace(/\D/g, "") };
        if (!next.nameTouched && info && !("error" in info)) next.name = suggestName(info.adsetName, startLocal, num(next.ageMin), num(next.ageMax));
        return next;
      }),
    }));
  }

  const allCopies = useMemo(() => Object.entries(copies).flatMap(([mid, list]) => list.map((c) => ({ mid, c }))), [copies]);
  const addedBudget = useMemo(
    () => allCopies.reduce((s, { mid, c }) => s + (num(c.budget) ?? (infos[mid] && !("error" in infos[mid]) ? ((infos[mid] as ModelInfo).dailyBudget ?? 0) : 0)), 0),
    [allCopies, infos],
  );

  const speed = useMemo(
    () =>
      ins && !ins.insights_failed
        ? computeSpeed({ monthlyTarget: monthly, spentSoFar: ins.spend, spentUntilYesterday: untilY, cpa: ins.cost_per_result, cpaTarget, dailyBudget: ins.daily_budget })
        : null,
    [ins, monthly, untilY, cpaTarget],
  );
  const ref = speed ? budgetReference(speed) : null;
  const current = ins && !ins.insights_failed && !ins.budget_failed ? ins.daily_budget : null;
  const missingNow = ref?.value != null && current != null ? ref.value - current : null;
  const after = current != null ? current + (activate ? addedBudget : 0) : null;
  const missingAfter = ref?.value != null && after != null ? ref.value - after : null;

  const validationError = useMemo(() => {
    for (const { mid, c } of allCopies) {
      const info = infos[mid];
      if (!info || "error" in info) continue;
      if (!c.name.trim()) return "Tem cópia sem nome.";
      const mn = num(c.ageMin);
      const mx = num(c.ageMax);
      if (mn == null || mx == null || mn < 18 || mx > 65 || mn > mx) return `Idade inválida em "${c.name}" (18 a 65).`;
      if (info.dailyBudget != null) {
        const b = num(c.budget);
        if (b == null || b < 6) return `Orçamento mínimo de R$ 6,00 em "${c.name}".`;
      }
      if (!Object.values(c.ads).some((v) => v !== "OFF")) return `"${c.name}" está sem nenhum criativo.`;
    }
    return null;
  }, [allCopies, infos]);

  async function send() {
    if (validationError || !allCopies.length) return;
    setSending(true);
    const queue = [...allCopies];
    const one = async ({ mid, c }: { mid: string; c: CopyDraft }) => {
      const info = infos[mid] as ModelInfo;
      setResults((r) => ({ ...r, [c.key]: "running" }));
      try {
        const budget = num(c.budget);
        const res = await fetch("/api/analysis/duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adsetId: mid,
            name: c.name.trim(),
            ads: info.ads.filter((a) => c.ads[a.id] !== "OFF").map((a) => ({ id: a.id, name: a.name, status: c.ads[a.id] })),
            dailyBudget: info.dailyBudget != null && budget != null && budget !== info.dailyBudget ? budget : null,
            ageMin: num(c.ageMin),
            ageMax: num(c.ageMax),
            startTime: brtIso(startLocal),
          }),
        });
        const d = (await res.json()) as {
          ok: boolean;
          error?: string;
          newAdsetId?: string;
          warnings?: string[];
          failedAds?: Array<{ name: string; error: string }>;
          copiedAds?: unknown[];
          check?: { whatsapp: string | null; modelWhatsapp: string | null };
        };
        if (!d.ok || !d.newAdsetId) throw new Error(d.error ?? "A Meta não criou o conjunto.");
        const warn = [...(d.warnings ?? []), ...(d.failedAds ?? []).map((f) => `${f.name}: ${f.error}`)];
        const whatsOk = !!d.check && d.check.whatsapp === d.check.modelWhatsapp;
        let text = `Criado (pausado) com ${(d.copiedAds ?? []).length} criativo(s). WhatsApp ${whatsOk ? "✓ igual ao modelo" : "✗ diferente — não ativado"}.`;
        if (activate && whatsOk) {
          const a = (await fetch("/api/analysis/activate-adset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adsetId: d.newAdsetId }),
          }).then((r) => r.json())) as { ok: boolean; error?: string; startTime?: string | null; campaignStatus?: string };
          if (a.ok) {
            const future = a.startTime && Date.parse(a.startTime) > Date.now();
            text = `Criado e ativado${future ? " (programado)" : ""} com ${(d.copiedAds ?? []).length} criativo(s). WhatsApp ✓.${a.campaignStatus && a.campaignStatus !== "ACTIVE" ? " Atenção: a campanha está pausada." : ""}`;
          } else warn.push(`Não ativou: ${a.error ?? "erro"}`);
        }
        setResults((r) => ({ ...r, [c.key]: { ok: true, text, warn } }));
      } catch (e) {
        setResults((r) => ({ ...r, [c.key]: { ok: false, text: (e as Error).message } }));
      }
    };
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await one(it);
    };
    await Promise.all([worker(), worker()]);
    setSending(false);
    onDone();
  }

  const done = Object.keys(results).length > 0 && !sending;
  const card = "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";
  const inp = "h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={sending ? undefined : onClose}>
      <div
        className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Editor em massa · {accountName}</h3>
            <p className="text-xs text-zinc-500">
              {models.length} conjunto(s) modelo · {allCopies.length} cópia(s). Criativo: clique pra alternar ativo → pausado → fora.
            </p>
          </div>
          <button onClick={onClose} disabled={sending} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800">
            ✕
          </button>
        </div>

        {/* Ritmo */}
        <div className="grid gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          {ritmoErr && !ins ? (
            <p className="text-xs text-red-600 sm:col-span-4">Ritmo indisponível: {ritmoErr}</p>
          ) : !speed ? (
            <p className="text-xs text-zinc-500 sm:col-span-4">Carregando o investimento e o Ritmo…</p>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Investimento atual / dia</div>
                <div className="font-semibold tabular-nums">{current != null ? fmtCurrency(current) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Ritmo ({ref?.label})</div>
                <div className="font-semibold tabular-nums">{ref?.value != null ? fmtCurrency(ref.value) : monthly == null ? "sem meta mensal" : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Falta hoje</div>
                <div className={`font-semibold tabular-nums ${missingNow != null && missingNow > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {missingNow == null ? "—" : missingNow > 0 ? fmtCurrency(missingNow) : `acima ${fmtCurrency(-missingNow)}`}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  Com as cópias {activate ? "" : "(se ativar)"} (+{fmtCurrency(addedBudget)})
                </div>
                <div className={`font-semibold tabular-nums ${missingAfter != null && missingAfter > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {after != null ? fmtCurrency(activate ? after : (current ?? 0) + addedBudget) : "—"}
                  {missingAfter != null || (!activate && ref?.value != null && current != null) ? (
                    <span className="ml-1 text-xs font-normal">
                      {(() => {
                        const m = activate ? (missingAfter as number) : (ref!.value as number) - ((current as number) + addedBudget);
                        return m > 0 ? `· falta ${fmtCurrency(m)}` : `· acima ${fmtCurrency(-m)}`;
                      })()}
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {models.map((m) => {
            const info = infos[m.id];
            const list = copies[m.id] ?? [];
            return (
              <div key={m.id} className={card}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50" title={m.name}>
                    {m.name}
                  </span>
                  {info && !("error" in info) ? (
                    <>
                      <span className="text-xs text-zinc-500">WhatsApp {info.whatsapp ?? "da página"}</span>
                      <label className="flex items-center gap-1 text-xs">
                        Cópias
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={list.length}
                          disabled={sending || done}
                          onChange={(e) => setCount(m.id, Number(e.target.value))}
                          className={`${inp} w-16 text-center`}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
                {!info ? <p className="text-xs text-zinc-500">Carregando o modelo…</p> : null}
                {info && "error" in info ? <p className="text-xs text-red-600">{info.error}</p> : null}
                {info && !("error" in info) && info.budgetNote ? <p className="mb-1 text-xs text-zinc-500">{info.budgetNote}</p> : null}
                {info && !("error" in info)
                  ? list.map((c, idx) => {
                      const res = results[c.key];
                      return (
                        <Fragment key={c.key}>
                          <div className="mt-2 flex flex-col gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-950/40">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-zinc-500">#{idx + 1}</span>
                              <input
                                value={c.name}
                                disabled={sending || done}
                                onChange={(e) => patch(m.id, c.key, { name: e.target.value, nameTouched: true })}
                                className={`${inp} min-w-0 flex-1`}
                              />
                              <span className="flex items-center gap-1 text-xs">
                                Idade
                                <input value={c.ageMin} disabled={sending || done} onChange={(e) => patchAge(m.id, c.key, "ageMin", e.target.value)} inputMode="numeric" className={`${inp} w-12 text-center`} />
                                a
                                <input value={c.ageMax} disabled={sending || done} onChange={(e) => patchAge(m.id, c.key, "ageMax", e.target.value)} inputMode="numeric" className={`${inp} w-12 text-center`} />
                              </span>
                              {info.dailyBudget != null ? (
                                <span className="flex items-center gap-1 text-xs">
                                  R$
                                  <input value={c.budget} disabled={sending || done} onChange={(e) => patch(m.id, c.key, { budget: e.target.value })} inputMode="decimal" className={`${inp} w-16 text-right`} />
                                  /dia
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {info.ads.map((a) => {
                                const ch = c.ads[a.id] ?? "OFF";
                                return (
                                  <button
                                    key={a.id}
                                    disabled={sending || done}
                                    onClick={() => patch(m.id, c.key, { ads: { ...c.ads, [a.id]: CHOICE_NEXT[ch] } })}
                                    title={`${a.name} — no modelo: ${a.status === "ACTIVE" ? "ativo" : "pausado"}. Clique pra trocar.`}
                                    className={`max-w-[16rem] truncate rounded-full border px-2 py-0.5 text-xs ${CHOICE_CLS[ch]}`}
                                  >
                                    {a.name} · {CHOICE_LABEL[ch]}
                                  </button>
                                );
                              })}
                            </div>
                            {res ? (
                              res === "running" ? (
                                <p className="text-xs text-zinc-500">Criando…</p>
                              ) : (
                                <div className={`text-xs ${res.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>
                                  {res.ok ? "✓ " : "✗ "}
                                  {res.text}
                                  {(res.warn ?? []).map((w, i) => (
                                    <p key={i} className="text-amber-700 dark:text-amber-300">
                                      {w}
                                    </p>
                                  ))}
                                </div>
                              )
                            ) : null}
                          </div>
                        </Fragment>
                      );
                    })
                  : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <label className="flex items-center gap-1 text-sm">
            Início
            <select value={startMode} disabled={sending || done} onChange={(e) => setStartMode(e.target.value as "tomorrow" | "now" | "custom")} className={inp}>
              <option value="tomorrow">Amanhã às 05h</option>
              <option value="now">Agora</option>
              <option value="custom">Outro horário…</option>
            </select>
            {startMode === "custom" ? (
              <input type="datetime-local" value={customStart} disabled={sending || done} onChange={(e) => setCustomStart(e.target.value)} className={inp} />
            ) : null}
          </label>
          <label className="flex items-center gap-1 text-sm" title="Depois de criar, só ativa se o WhatsApp lido de volta for igual ao do modelo">
            <input type="checkbox" checked={activate} disabled={sending || done} onChange={(e) => setActivate(e.target.checked)} />
            Ativar depois de conferir o WhatsApp
          </label>
          {validationError ? <span className="text-xs text-red-600">{validationError}</span> : null}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} disabled={sending} className="h-9 rounded-md border border-zinc-300 px-3 text-sm disabled:opacity-40 dark:border-zinc-700">
              {done ? "Fechar" : "Cancelar"}
            </button>
            {!done ? (
              <button
                onClick={() => void send()}
                disabled={sending || !!validationError || allCopies.length === 0}
                className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {sending ? `Enviando… (${Object.values(results).filter((r) => r !== "running").length}/${allCopies.length})` : `Enviar ${allCopies.length} cópia(s)`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
