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

export interface Linha extends Cliente {
  nums: AccountNumbers | null; // null = a Meta não respondeu pra essa conta
  offers: OffersSummary | null;
  offersAt: string | null;
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

export function useCarteira() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const run = useRef(0);

  const load = useCallback(async () => {
    const my = ++run.current;
    setLoading(true);
    setError(null);
    try {
      const clientes = (await loadClientes()).filter((c) => c.selected && c.active && !c.archived);
      const cal = calendarSP();
      const days = Math.max(4, cal.day);
      const [daily, offers] = await Promise.all([
        dailyFor(
          clientes.map((c) => c.rawId),
          days,
        ),
        fetch("/api/analysis/offers", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({})),
      ]);
      if (my !== run.current) return;
      const snap = ((offers as { accounts?: Record<string, { at: string; summary: OffersSummary }> }).accounts ?? {}) as Record<
        string,
        { at: string; summary: OffersSummary }
      >;
      setLinhas(
        clientes.map((c) => ({
          ...c,
          nums: daily[c.id] ? numbersFrom(daily[c.id], cal) : null,
          offers: snap[c.id]?.summary ?? null,
          offersAt: snap[c.id]?.at ?? null,
        })),
      );
      setAt(Date.now());
    } catch (e) {
      if (my === run.current) setError((e as Error).message);
    } finally {
      if (my === run.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- primeira busca ao abrir a tela
    void load();
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
