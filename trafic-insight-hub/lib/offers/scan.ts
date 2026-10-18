// Ofertas ativas (Etapa 149) — busca na Meta o que existiu no MÊS CORRENTE em cada conta IVS e resume por tipo
// (regra em lib/offers/rule.ts). "Existiu" = conjunto com gasto no mês OU ligado agora (ativo/programado).

import type { createClient } from "@/lib/supabase/server";
import { metaGetAll } from "@/lib/meta/client";
import { ACTIVE_ISH_STATUSES } from "@/lib/meta/insights";
import { namingAccounts } from "@/lib/naming/scan";
import { summarizeOffers, type OfferAdset, type OffersSummary } from "@/lib/offers/rule";

type Db = Awaited<ReturnType<typeof createClient>>;

const VAGA_RE = /\bvaga\b/i;
const CONCURRENCY = 3;

export async function offersForAccount(token: string, adAccountId: string): Promise<OffersSummary> {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const [spent, live] = await Promise.all([
    metaGetAll<{ adset_id?: string; adset_name?: string; campaign_name?: string; spend?: string }>(token, `/${act}/insights`, {
      fields: "adset_id,adset_name,campaign_name,spend",
      level: "adset",
      date_preset: "this_month",
      limit: "500",
    }),
    metaGetAll<{ id: string; name?: string; campaign?: { name?: string } }>(token, `/${act}/adsets`, {
      fields: "id,name,campaign{name}",
      limit: "200",
      filtering: JSON.stringify([{ field: "adset.effective_status", operator: "IN", value: ACTIVE_ISH_STATUSES }]),
    }),
  ]);

  const byId = new Map<string, OfferAdset>();
  for (const r of spent) {
    if (!r.adset_id || VAGA_RE.test(r.campaign_name ?? "")) continue;
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    byId.set(r.adset_id, { name: r.adset_name ?? "", active: false, spend });
  }
  for (const a of live) {
    if (VAGA_RE.test(a.campaign?.name ?? "")) continue;
    const cur = byId.get(a.id);
    if (cur) cur.active = true;
    else byId.set(a.id, { name: a.name ?? "", active: true, spend: 0 });
  }
  return summarizeOffers([...byId.values()]);
}

export interface OffersResult {
  offers: Record<string, OffersSummary>;
  failed: string[];
  notIvs: string[];
}

// Só contas IVS exibidas e ativas (o padrão de nomes é delas). Outras contas voltam em notIvs.
export async function offersForAccounts(db: Db, userId: string, token: string, requested: string[]): Promise<OffersResult> {
  const ivs = await namingAccounts(db, userId);
  const ivsIds = new Set(ivs.map((a) => a.ad_account_id.replace(/^act_/, "")));
  const wanted = requested.map((id) => id.replace(/^act_/, ""));
  const todo = wanted.filter((id) => ivsIds.has(id));
  const notIvs = wanted.filter((id) => !ivsIds.has(id));
  const offers: Record<string, OffersSummary> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      try {
        offers[id] = await offersForAccount(token, id);
      } catch (e) {
        console.error("offers err", id, (e as Error).message);
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { offers, failed, notIvs };
}
