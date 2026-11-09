"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import type { OffersSummary } from "@/lib/offers/rule";
import { calendarSP, numbersFrom, type AccountNumbers } from "@/lib/estrategia/calc";

// Etapa 238: carteira do Hub estratégico — clientes (Supabase) + números do mês (backup diário + hoje ao vivo) + ofertas
// (retrato guardado). Uma busca só, compartilhada pelas abas Acompanhamento e Alertas.

export interface Cliente {
  id: string; // id da conta sem "act_"
  rawId: string; // como está gravado
  name: string;
  responsible: string | null;
  cpaTarget: number | null;
  monthly: number | null;
  priority: string | null;
  active: boolean;
  archived: boolean;
  selected: boolean; // está nas "Contas exibidas"
  clientSince: string | null;
  whatsapp: string | null;
  waGroup: string | null; // Etapa 248: nome do grupo de WhatsApp do cliente (pesquisa)
}

export interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  responsible?: string | null;
  cpa_target?: number | null;
  monthly_investment?: number | null;
  priority?: string | null;
  active?: boolean;
  archived?: boolean;
  client_since?: string | null;
  whatsapp_contact?: string | null;
  wa_group_name?: string | null;
}

export const normId = (id: string) => id.replace(/^act_/, "");

export function clienteFrom(b: Binding, selected: Set<string>): Cliente {
  const id = normId(b.ad_account_id);
  return {
    id,
    rawId: b.ad_account_id,
    name: (b.client_name ?? "").trim() || id,
    responsible: b.responsible?.trim() || null,
    cpaTarget: b.cpa_target != null ? Number(b.cpa_target) : null,
    monthly: b.monthly_investment != null ? Number(b.monthly_investment) : null,
    priority: b.priority ?? null,
    active: b.active !== false,
    archived: !!b.archived,
    selected: selected.has(id),
    clientSince: b.client_since ?? null,
    whatsapp: b.whatsapp_contact ?? null,
    waGroup: b.wa_group_name?.trim() || null,
  };
}

export async function loadClientes(): Promise<Cliente[]> {
  const [a, b] = await Promise.all([
    fetch("/api/selected-accounts", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/account-bindings", { cache: "no-store" }).then((r) => r.json()),
  ]);
  if (b.error) throw new Error(b.error);
  const selected = new Set<string>(((a.accountIds ?? []) as string[]).map(normId));
  return ((b.bindings ?? []) as Binding[])
    .map((x) => clienteFrom(x, selected))
    .sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
}

export interface OfferFlags {
  exame: boolean;
  promo?: boolean; // Etapa 260: as 3 ofertas são GERAL (todas), EXAME e PROMO
  boleto?: boolean; // antigo (não é mais usado)
}

export interface Linha extends Cliente {
  nums: AccountNumbers | null; // null = a Meta não respondeu pra essa conta
  offers: OffersSummary | null;
  offersAt: string | null;
  // Etapa 242: investimento diário atual (orçamento do dia de tudo que está ligado). undefined = carregando; null = falhou.
  dailyBudget?: number | null;
  // Etapa 242: se a conta anuncia EXAME / BOLETO (GERAL todas anunciam). null = ainda não definido.
  flags: OfferFlags | null;
}

export async function loadOfferFlags(): Promise<Record<string, OfferFlags>> {
  const d = await fetch("/api/estrategia/prefs?key=offer_flags", { cache: "no-store" }).then((r) => r.json());
  return d.value && typeof d.value === "object" ? (d.value as Record<string, OfferFlags>) : {};
}

export async function saveOfferFlags(all: Record<string, OfferFlags>): Promise<void> {
  const d = await fetch("/api/estrategia/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "offer_flags", value: all }),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
}

// Investimento diário atual: mesma conta do hub antigo (orçamento diário de campanhas/conjuntos ligados), em lotes.
async function budgetsFor(ids: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const d = await fetch("/api/meta/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ accountIds: c, datePreset: "today" }),
        }).then((r) => r.json());
        const ins = (d.insights ?? {}) as Record<string, { daily_budget?: number; budget_failed?: boolean }>;
        for (const id of c) {
          const x = ins[id];
          out[normId(id)] = x && !x.budget_failed && typeof x.daily_budget === "number" ? x.daily_budget : null;
        }
      } catch {
        for (const id of c) out[normId(id)] = null;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

// Contas por chamada ao daily-cpa (pra não estourar o tempo da função com 50 contas de uma vez).
const CHUNK = 10;

async function dailyFor(ids: string[], days: number): Promise<Record<string, DailyCpaPoint[]>> {
  const out: Record<string, DailyCpaPoint[]> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const d = await fetch("/api/meta/daily-cpa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ accountIds: c, days, includeToday: true }),
        }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
        for (const [k, v] of Object.entries((d.daily ?? {}) as Record<string, DailyCpaPoint[]>)) out[normId(k)] = v;
      } catch (e) {
        // Um lote que falhou não derruba a tela: essas contas aparecem "sem dados" e o resto segue.
        console.error("estrategia daily err", (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

// Etapa 247: números travados — a carteira carregada fica guardada neste navegador e é o que aparece ao abrir, trocar de
// aba ou dar refresh. Busca de novo na Meta só no botão "Atualizar" ou quando os números ficaram velhos (Etapa 248:
// mais de 2 horas sem atualizar, ou de outro dia) — aí atualiza sozinho ao abrir ou ao voltar pra aba.
const CACHE_KEY = "estr_carteira_v1";
export const STALE_MS = 2 * 3600_000;
export const isStale = (at: number | null) =>
  at == null || Date.now() - at > STALE_MS || new Date(at).toDateString() !== new Date().toDateString();
export function readCache<T>(key: string): { at: number; data: T } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as { at?: number; data?: T };
    return typeof p.at === "number" && p.data != null ? { at: p.at, data: p.data } : null;
  } catch {
    return null;
  }
}
export function writeCache(key: string, data: unknown, at = Date.now()) {
  try {
    localStorage.setItem(key, JSON.stringify({ at, data }));
  } catch {
    /* sem espaço/sem armazenamento: segue só na memória */
  }
}

export function useCarteira() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const run = useRef(0);
  const atRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const my = ++run.current;
    setLoading(true);
    setError(null);
    try {
      const clientes = (await loadClientes()).filter((c) => c.selected && c.active && !c.archived);
      const cal = calendarSP();
      // Etapa 292: 14 dias no mínimo (semana passada + últimos 7 dias podem pegar o mês anterior)
      const days = Math.max(14, cal.day);
      const [daily, offers, flagsSaved] = await Promise.all([
        dailyFor(
          clientes.map((c) => c.rawId),
          days,
        ),
        fetch("/api/analysis/offers", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({})),
        loadOfferFlags().catch(() => ({}) as Record<string, OfferFlags>),
      ]);
      if (my !== run.current) return;
      const snap = ((offers as { accounts?: Record<string, { at: string; summary: OffersSummary }> }).accounts ?? {}) as Record<
        string,
        { at: string; summary: OffersSummary }
      >;
      // Etapa 242: quem anuncia EXAME/BOLETO — na primeira vez, preenche sozinho pelo que rodou no mês (retrato das ofertas)
      // e grava. Depois disso só muda pela ficha do cliente.
      const flags: Record<string, OfferFlags> = { ...flagsSaved };
      let changed = false;
      for (const c of clientes) {
        if (flags[c.id] || !snap[c.id]) continue;
        const s = snap[c.id].summary;
        flags[c.id] = { exame: s.exame.status !== "INEXISTENTE", promo: s.promo.length > 0 };
        changed = true;
      }
      if (changed) void saveOfferFlags(flags).catch(() => {});
      setLinhas(
        clientes.map((c) => ({
          ...c,
          nums: daily[c.id] ? numbersFrom(daily[c.id], cal) : null,
          offers: snap[c.id]?.summary ?? null,
          offersAt: snap[c.id]?.at ?? null,
          flags: flags[c.id] ?? null,
        })),
      );
      const now = Date.now();
      setAt(now);
      atRef.current = now;
      // Investimento diário atual: chega depois (mais lento), sem segurar a tabela.
      void budgetsFor(clientes.map((c) => c.rawId)).then((b) => {
        if (my !== run.current) return;
        setLinhas((cur) => {
          const next = (cur ?? []).map((l) => ({ ...l, dailyBudget: l.id in b ? b[l.id] : null }));
          writeCache(CACHE_KEY, next, now);
          return next;
        });
      });
    } catch (e) {
      if (my === run.current) setError((e as Error).message);
    } finally {
      if (my === run.current) setLoading(false);
    }
  }, []);

  // Guarda também a tabela assim que chega (antes do investimento diário).
  useEffect(() => {
    if (linhas && atRef.current) writeCache(CACHE_KEY, linhas, atRef.current);
  }, [linhas]);

  useEffect(() => {
    const c = readCache<Linha[]>(CACHE_KEY);
    if (c) {
      // Números travados: mostra o que foi carregado da última vez.
      atRef.current = c.at;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lê os números guardados neste navegador
      setLinhas(c.data.map((l) => ({ ...l, waGroup: l.waGroup ?? null })));
      setAt(c.at);
    }
    // Etapa 257: só busca sozinho na primeira vez neste navegador. Depois disso, a Meta só é consultada no botão
    // "Atualizar" (as auditorias automáticas é que gastam as requisições; a tela não fica atualizando sozinha).
    if (!c) {
      void load();
      return;
    }
    // Etapa 290: o que vem da ficha do cliente (nome, gestor, prioridade, metas, grupo) é recarregado sempre que a tela
    // abre — é só o Supabase, nada da Meta. Conta que saiu da carteira some; conta nova entra (sem números até Atualizar).
    void loadClientes()
      .then((all) => {
        const vivos = all.filter((x) => x.selected && x.active && !x.archived);
        setLinhas((cur) => {
          if (!cur) return cur;
          const old = new Map(cur.map((l) => [l.id, l]));
          return vivos.map((x) => {
            const o = old.get(x.id);
            return o ? { ...o, ...x } : ({ ...x, nums: null, offers: null, offersAt: null, flags: null } as Linha);
          });
        });
      })
      .catch(() => {});
  }, [load]);

  const patchLinha = useCallback((id: string, patch: Partial<Linha>) => {
    setLinhas((cur) => (cur ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  return { linhas, loading, error, at, reload: load, patchLinha };
}

export function matchesResp(resp: string, responsible: string | null): boolean {
  if (!resp) return true;
  if (resp === "__none") return !responsible;
  return responsible === resp;
}
