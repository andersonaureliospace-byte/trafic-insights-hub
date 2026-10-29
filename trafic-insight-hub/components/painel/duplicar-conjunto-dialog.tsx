"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import { isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";
import { adsManagerEntityUrl } from "@/lib/meta/ads-manager-link";
import { AdPreviewDialog } from "@/components/painel/ad-preview-dialog";

// Etapa 231: também usado em Conjuntos da conta ("Duplicar" / "Novo conjunto" a partir do mais recente da campanha).
// Ganhou idade, início (amanhã 05h / agora / outro horário), conferência do WhatsApp lendo de volta, prévia e "Ativar".

function brtParts(d: Date): { y: string; m: string; d: string } {
  const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .split("-");
  return { y, m, d: dd };
}
// "AAAA-MM-DDTHH:MM" (horário de Brasília) → ISO com fuso -03:00.
const brtIso = (local: string) => `${local}:00-0300`;
function tomorrow5(): string {
  const p = brtParts(new Date(Date.now() + 86_400_000));
  return `${p.y}-${p.m}-${p.d}T05:00`;
}
function nowLocal(): string {
  const p = brtParts(new Date());
  const hm = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return `${p.y}-${p.m}-${p.d}T${hm}`;
}
// Acerta a data (dd/mm) e a idade (nn-nn ou nn-nn+) do nome pelo padrão TEMA | OFERTA | CIDADE | IDADE | CRIATIVO | AND | DD/MM.
function suggestName(base: string, startLocal: string, min: number | null, max: number | null): string {
  let n = base;
  const dm = startLocal ? `${startLocal.slice(8, 10)}/${startLocal.slice(5, 7)}` : null;
  if (dm) n = n.replace(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\b/g, dm);
  if (min != null && max != null) n = n.replace(/\b\d{2}\s?-\s?\d{2}\+?(?=\s|\||$)/, `${min}-${max}${max >= 65 ? "+" : ""}`);
  return n;
}

// Etapa 159: janelinha "Duplicar conjunto" (Análise > CPA abaixo da meta). Mostra os criativos ATIVOS do conjunto com o CPA de cada um
// (os acima da meta já vêm desmarcados), o nome sugerido (data de hoje no lugar da antiga) e o orçamento diário. A cópia nasce PAUSADA.

export interface DuplicateAdsetInput {
  id: string;
  name: string;
  accountId: string;
  cpaTarget: number | null;
  ads: Array<{ id: string; spend: number; conversations: number | null; cost_per_conversation: number | null }>;
  statsPeriod?: string; // Etapa 231: sem `ads`, busca os números dos criativos nesse período (ex.: "7d")
  title?: string;
}

interface Info {
  adsetName: string;
  suggestedName: string;
  dailyBudget: number | null;
  budgetNote: string | null;
  ads: Array<{ id: string; name: string; status: string }>;
  ageMin: number | null;
  ageMax: number | null;
  whatsapp: string | null;
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
  check?: { whatsapp: string | null; modelWhatsapp: string | null; ageMin: number | null; ageMax: number | null; startTime: string | null; campaignStatus: string | null };
}

export function DuplicarConjuntoDialog({ adset, onClose }: { adset: DuplicateAdsetInput; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [startMode, setStartMode] = useState<"tomorrow" | "now" | "custom">("tomorrow");
  const [customStart, setCustomStart] = useState(tomorrow5());
  const [baseName, setBaseName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [fetchedStats, setFetchedStats] = useState<DuplicateAdsetInput["ads"]>([]);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateCampaign, setActivateCampaign] = useState(false);
  const [activated, setActivated] = useState<{ ok: boolean; text: string } | null>(null);

  const startLocal = startMode === "tomorrow" ? tomorrow5() : startMode === "now" ? nowLocal() : customStart;
  // Nome sugerido acompanha a data de início e a idade, até você editar o nome à mão.
  useEffect(() => {
    if (!baseName || nameTouched) return;
    const min = ageMin ? Number(ageMin) : null;
    const max = ageMax ? Number(ageMax) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- nome sugerido segue início/idade
    setName(suggestName(baseName, startLocal, min, max));
  }, [baseName, nameTouched, startLocal, ageMin, ageMax]);

  useEffect(() => {
    if (adset.ads.length || !adset.statsPeriod) return;
    let alive = true;
    fetch("/api/analysis/adset-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adsetId: adset.id, period: adset.statsPeriod }),
    })
      .then((r) => r.json())
      .then((d: { ads?: Array<{ id: string; spend: number; conversations: number; cpl: number | null }> }) => {
        if (alive && d.ads) setFetchedStats(d.ads.map((a) => ({ id: a.id, spend: a.spend, conversations: a.conversations, cost_per_conversation: a.cpl })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [adset.id, adset.ads.length, adset.statsPeriod]);

  const statsById = useMemo(() => new Map((adset.ads.length ? adset.ads : fetchedStats).map((a) => [a.id, a])), [adset.ads, fetchedStats]);
  const flaggedOf = (st: DuplicateAdsetInput["ads"][number] | undefined) =>
    !!st && adset.cpaTarget != null && isCreativeFlaggedAbove(st as Parameters<typeof isCreativeFlaggedAbove>[0], adset.cpaTarget);

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
        setBaseName(d.adsetName);
        setAgeMin(d.ageMin != null ? String(d.ageMin) : "");
        setAgeMax(d.ageMax != null ? String(d.ageMax) : "");
        setBudget(d.dailyBudget != null ? String(d.dailyBudget).replace(".", ",") : "");
        // Criativos acima da meta (R$4+) já vêm desmarcados.
        setSelected(
          new Set(
            d.ads
              .filter((a) => {
                const st = statsById.get(a.id);
                return !(st && adset.cpaTarget != null && isCreativeFlaggedAbove(st as Parameters<typeof isCreativeFlaggedAbove>[0], adset.cpaTarget));
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
          ageMin: ageMin ? Number(ageMin) : null,
          ageMax: ageMax ? Number(ageMax) : null,
          startTime: brtIso(startLocal),
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

  async function activate() {
    if (!result?.newAdsetId) return;
    if (result.check && result.check.whatsapp !== result.check.modelWhatsapp && !confirm("O WhatsApp do conjunto novo é diferente do modelo. Ativar mesmo assim?")) return;
    setActivating(true);
    setActivated(null);
    try {
      const res = await fetch("/api/analysis/activate-adset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsetId: result.newAdsetId, activateCampaign }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string; startTime?: string | null; campaignStatus?: string };
      if (!d.ok) throw new Error(d.error ?? "Erro desconhecido");
      const future = d.startTime && Date.parse(d.startTime) > Date.now();
      const when = d.startTime
        ? new Date(d.startTime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "";
      setActivated({
        ok: true,
        text: `${future ? `Conjunto ativado — começa a rodar em ${when}.` : "Conjunto ativado e rodando."}${d.campaignStatus && d.campaignStatus !== "ACTIVE" ? " Atenção: a campanha continua pausada." : ""}`,
      });
    } catch (e) {
      setActivated({ ok: false, text: `Não deu pra ativar: ${(e as Error).message}` });
    } finally {
      setActivating(false);
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
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{adset.title ?? "Duplicar conjunto"}</h3>
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
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                className="h-9 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-xs text-zinc-500">A data e a idade do nome acompanham o início e a idade escolhidos (até você editar o nome).</span>
            </label>

            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Idade</span>
                <span className="flex items-center gap-1">
                  <input
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    className="h-9 w-14 rounded-md border border-zinc-300 bg-white px-2 text-center dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span className="text-xs text-zinc-500">a</span>
                  <input
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    className="h-9 w-14 rounded-md border border-zinc-300 bg-white px-2 text-center dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Início</span>
                <span className="flex flex-wrap items-center gap-1">
                  <select
                    value={startMode}
                    onChange={(e) => setStartMode(e.target.value as "tomorrow" | "now" | "custom")}
                    className="h-9 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="tomorrow">Amanhã às 05h</option>
                    <option value="now">Agora</option>
                    <option value="custom">Outro horário…</option>
                  </select>
                  {startMode === "custom" ? (
                    <input
                      type="datetime-local"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="h-9 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  ) : null}
                </span>
              </label>
            </div>
            <p className="-mt-2 text-xs text-zinc-500">
              WhatsApp do modelo: <b>{info.whatsapp ?? "não informado (usa o padrão da página)"}</b> — o conjunto novo vai com o mesmo número.
            </p>

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
                    const flagged = flaggedOf(st);
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
              <p className="text-xs text-zinc-500">Só criativos ativos aparecem (mesma legenda, título e vídeo). A cópia nasce pausada: confira e ative aqui mesmo.</p>
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
            {result.check ? (
              <div className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-700">
                <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Conferência (lido de volta na Meta)</p>
                <p className={result.check.whatsapp && result.check.whatsapp === result.check.modelWhatsapp ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}>
                  WhatsApp: {result.check.whatsapp ?? "não informado"}{" "}
                  {result.check.whatsapp && result.check.whatsapp === result.check.modelWhatsapp ? "✓ igual ao modelo" : `✗ modelo: ${result.check.modelWhatsapp ?? "não informado"}`}
                </p>
                <p>
                  Idade: {result.check.ageMin ?? "?"}–{result.check.ageMax ?? "?"} · Início:{" "}
                  {result.check.startTime
                    ? new Date(result.check.startTime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : "—"}{" "}
                  · Campanha: {result.check.campaignStatus === "ACTIVE" ? "ativa" : (result.check.campaignStatus ?? "—").toLowerCase()}
                </p>
              </div>
            ) : null}
            {result.copiedAds.some((c) => c.newId) ? (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-zinc-500">Prévia dos anúncios novos:</span>
                {result.copiedAds
                  .filter((c) => c.newId)
                  .map((c, i) => {
                    const nm = info?.ads.find((a) => a.id === c.sourceId)?.name ?? `Anúncio ${i + 1}`;
                    return (
                      <button
                        key={c.newId}
                        onClick={() => setPreview({ id: c.newId as string, name: nm })}
                        className="h-7 rounded border border-zinc-300 px-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        title={nm}
                      >
                        {nm.length > 28 ? `${nm.slice(0, 28)}…` : nm}
                      </button>
                    );
                  })}
              </div>
            ) : null}
            {preview ? <AdPreviewDialog adId={preview.id} name={preview.name} onClose={() => setPreview(null)} /> : null}
            {activated ? (
              <p className={`rounded-md p-3 text-xs ${activated.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>
                {activated.text}
              </p>
            ) : null}
            {result.warnings.map((w, i) => (
              <p key={i} className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {w}
              </p>
            ))}
            <div className="flex justify-end gap-2">
              {result.newAdsetId && !activated?.ok ? (
                <div className="mr-auto flex flex-wrap items-center gap-2">
                  {result.check && result.check.campaignStatus !== "ACTIVE" ? (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={activateCampaign} onChange={(e) => setActivateCampaign(e.target.checked)} />
                      Ativar a campanha também (está {(result.check.campaignStatus ?? "pausada").toLowerCase()})
                    </label>
                  ) : null}
                  <button
                    onClick={() => void activate()}
                    disabled={activating}
                    className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {activating ? "Ativando…" : "Ativar conjunto"}
                  </button>
                </div>
              ) : null}
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
