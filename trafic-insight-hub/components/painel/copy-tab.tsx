"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import {
  COPY_CATEGORIES,
  DEFAULT_CONDICAO_TEXT,
  DEFAULT_TOM,
  type CopyCategory,
  type CopyExtraField,
  type CopyVariation,
} from "@/lib/copy/types";

interface Subcategory {
  id: string;
  category: CopyCategory;
  name: string;
  extra_fields: CopyExtraField[];
  oferta: string;
  condicao: string;
  tom: string;
  fixed: boolean;
}

interface Generation {
  id: string;
  category: CopyCategory;
  subcategory_name: string;
  variations: CopyVariation[];
  created_at: string;
}

function fmtDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

function variationText(address: string, v: CopyVariation): string {
  return [address ? `📍 ${address}` : "", v.copy, v.oferta, v.cta, v.condicao].filter(Boolean).join("\n\n");
}

// Aba Copy (Etapa 70) — Gerador de Copy do Instituto Visão Solidária. Ao
// contrário de Demandas (onde a IA só organiza texto já escrito, nunca
// inventa nada), aqui o usuário pediu explicitamente criatividade de
// verdade: a IA escreve 5 variações novas seguindo o padrão real da marca,
// usando os modelos de referência de cada subcategoria como exemplo.
export function CopyTab({
  accounts,
  bindings,
}: {
  accounts: AdAccount[];
  bindings: Record<string, { client_name: string | null; address: string | null } | undefined>;
}) {
  const [subcategories, setSubcategories] = useState<Subcategory[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState<string>("");
  const [category, setCategory] = useState<CopyCategory>("geral");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({});
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [newSubOferta, setNewSubOferta] = useState("");
  const [newSubCondicao, setNewSubCondicao] = useState("");
  const [newSubTom, setNewSubTom] = useState("");
  const [creatingSub, setCreatingSub] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [variations, setVariations] = useState<CopyVariation[] | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [history, setHistory] = useState<Generation[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/copy/subcategories");
      const d = await res.json();
      if (d.error) {
        setLoadError(d.error);
        return;
      }
      setSubcategories(d.subcategories);
    })();
  }, []);

  useEffect(() => {
    if (accounts.length > 0 && !accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seleciona o primeiro cliente assim que a lista chega
      setAccountId(accounts[0].account_id);
    }
  }, [accounts, accountId]);

  const subsOfCategory = useMemo(
    () => (subcategories ?? []).filter((s) => s.category === category),
    [subcategories, category],
  );

  useEffect(() => {
    if (subsOfCategory.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- não há subcategoria válida pra essa categoria
      setSubcategoryId("");
      return;
    }
    if (!subsOfCategory.some((s) => s.id === subcategoryId)) {
      // Subcategoria fixa (ex.: "Neutro" em Geral) é sempre a opção padrão
      // ao entrar numa categoria — pedido explícito do usuário — mesmo que
      // não seja a primeira da lista.
      const defaultSub = subsOfCategory.find((s) => s.fixed) ?? subsOfCategory[0];
      setSubcategoryId(defaultSub.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à troca de categoria/lista, não à seleção manual
  }, [subsOfCategory]);

  const selectedSub = subsOfCategory.find((s) => s.id === subcategoryId) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseta o formulário ao trocar de subcategoria
    setExtraFieldValues({});
    setVariations(null);
    setAddress(null);
    setGenError(null);
  }, [subcategoryId]);

  async function loadHistory(accId: string) {
    const res = await fetch(`/api/copy/generations?ad_account_id=${encodeURIComponent(accId)}`);
    const d = await res.json();
    if (!d.error) setHistory(d.generations);
  }

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- histórico depende do cliente selecionado
      setHistory(null);
      void loadHistory(accountId);
    }
  }, [accountId]);

  async function createSubcategory() {
    const name = newSubName.trim();
    if (!name) return;
    setCreatingSub(true);
    try {
      const res = await fetch("/api/copy/subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          name,
          oferta: newSubOferta,
          condicao: newSubCondicao,
          tom: newSubTom,
        }),
      });
      const d = await res.json();
      if (d.error) {
        setLoadError(d.error);
        return;
      }
      setSubcategories((prev) => [...(prev ?? []), d.subcategory]);
      setSubcategoryId(d.subcategory.id);
      setNewSubName("");
      setNewSubOferta("");
      setNewSubCondicao("");
      setNewSubTom("");
      setShowCreateSub(false);
    } finally {
      setCreatingSub(false);
    }
  }

  async function generate() {
    if (!accountId || !subcategoryId) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: accountId, subcategory_id: subcategoryId, extraFieldValues }),
      });
      const d = await res.json();
      if (d.error) {
        setGenError(d.error);
        return;
      }
      setAddress(d.address);
      setVariations(d.generation.variations);
      setHistory((prev) => [d.generation, ...(prev ?? [])]);
    } finally {
      setGenerating(false);
    }
  }

  async function regenerateOne(index: number) {
    if (!accountId || !subcategoryId || !variations) return;
    setRegeneratingIndex(index);
    try {
      const res = await fetch("/api/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: accountId,
          subcategory_id: subcategoryId,
          extraFieldValues,
          count: 1,
          save: false,
        }),
      });
      const d = await res.json();
      if (d.error) {
        setGenError(d.error);
        return;
      }
      const next = [...variations];
      next[index] = d.variations[0];
      setVariations(next);
    } finally {
      setRegeneratingIndex(null);
    }
  }

  async function copyVariation(index: number, v: CopyVariation) {
    try {
      await navigator.clipboard.writeText(variationText(address ?? "", v));
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1200);
    } catch {
      // clipboard indisponível — sem tratamento especial
    }
  }

  if (accounts.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma conta selecionada.</p>;
  }

  const missingAddress = accountId && !bindings[accountId]?.address;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Gerador de Copy — Instituto Visão Solidária</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Escolha o cliente e a categoria, e gere 5 variações de copy no padrão da marca.
        </p>

        {loadError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{loadError}</p> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Cliente</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            >
              {accounts.map((acc) => (
                <option key={acc.account_id} value={acc.account_id}>
                  {bindings[acc.account_id]?.client_name ?? acc.name}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Endereço</span>
            <p className={`px-2 py-1.5 ${missingAddress ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"}`}>
              {missingAddress
                ? "Sem endereço cadastrado — preencha em Painel → Clientes antes de gerar."
                : bindings[accountId]?.address}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {COPY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                category === c.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Subcategoria</span>
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              className="min-w-56 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            >
              {subsOfCategory.length === 0 ? <option value="">Nenhuma ainda</option> : null}
              {subsOfCategory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => setShowCreateSub((v) => !v)}
            className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium dark:border-zinc-700"
          >
            {showCreateSub ? "Cancelar" : "+ Nova subcategoria"}
          </button>
        </div>

        {showCreateSub ? (
          <div className="mt-3 space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Nome da subcategoria
              </span>
              <input
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="ex.: Exame por R$ 39,99"
                className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Oferta (opcional — deixe em branco pra IA seguir o padrão dos modelos de referência)
              </span>
              <input
                value={newSubOferta}
                onChange={(e) => setNewSubOferta(e.target.value)}
                placeholder="ex.: Armação por R$ 49,99 na compra das lentes"
                className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Condição (opcional)
                </span>
                <input
                  value={newSubCondicao}
                  onChange={(e) => setNewSubCondicao(e.target.value)}
                  placeholder={DEFAULT_CONDICAO_TEXT}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Tom de comunicação (opcional)
                </span>
                <input
                  value={newSubTom}
                  onChange={(e) => setNewSubTom(e.target.value)}
                  placeholder={DEFAULT_TOM}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                />
              </label>
            </div>
            <p className="text-xs text-zinc-400">
              Deixando Condição e Tom em branco, a subcategoria usa o padrão (condição genérica / tom neutro).
            </p>
            <button
              onClick={() => void createSubcategory()}
              disabled={creatingSub || !newSubName.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {creatingSub ? "Criando…" : "Criar subcategoria"}
            </button>
          </div>
        ) : null}

        {selectedSub && selectedSub.extra_fields.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {selectedSub.extra_fields.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{f.label}</span>
                <input
                  value={extraFieldValues[f.key] ?? ""}
                  onChange={(e) => setExtraFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                />
              </label>
            ))}
          </div>
        ) : null}

        {genError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{genError}</p> : null}

        <button
          onClick={() => void generate()}
          disabled={generating || !accountId || !subcategoryId || !!missingAddress}
          className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {generating ? "Gerando…" : "Gerar 5 variações"}
        </button>
      </div>

      {variations ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {variations.map((v, i) => (
            <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-medium text-zinc-400">Variação {i + 1}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">📍 {address}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{v.copy}</p>
              {v.oferta ? <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{v.oferta}</p> : null}
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{v.cta}</p>
              {v.condicao ? <p className="mt-2 text-xs text-zinc-400">{v.condicao}</p> : null}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void copyVariation(i, v)}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                >
                  {copiedIndex === i ? "Copiado!" : "Copiar"}
                </button>
                <button
                  onClick={() => void regenerateOne(i)}
                  disabled={regeneratingIndex === i}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                >
                  {regeneratingIndex === i ? "Gerando…" : "Gerar de novo"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {history && history.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Histórico deste cliente</h3>
          <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {history.map((g) => (
              <div key={g.id} className="py-2 text-sm">
                <p className="text-zinc-700 dark:text-zinc-300">
                  {COPY_CATEGORIES.find((c) => c.id === g.category)?.label} · {g.subcategory_name}
                  <span className="ml-2 text-xs text-zinc-400">{fmtDate(g.created_at)}</span>
                </p>
                <button
                  onClick={() => {
                    setVariations(g.variations);
                    setAddress(bindings[accountId]?.address ?? null);
                  }}
                  className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Ver as {g.variations.length} variações
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
