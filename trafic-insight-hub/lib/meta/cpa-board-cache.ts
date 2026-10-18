// Cache do Monitor de CPA (Etapa 61). "Ontem" e "Últimos 3 dias" são dias
// fechados — o CPA desses períodos não muda mais depois que o dia vira —
// então em vez de bater na Graph API toda vez que o usuário abre a aba ou
// troca de filtro, esses dois períodos ficam guardados na tabela genérica
// `meta_insights_cache` (já existia no schema, sem uso até agora) e só são
// recalculados 1x por dia, pelo hook público cpa-board-cache-tick (sugerido
// 07h10 no n8n, logo depois do cpa-alert-tick — mesmo motivo de esperar a
// Meta terminar de consolidar a atribuição de ontem). "Hoje", "Hoje e
// ontem" e "Mês atual" mudam a cada minuto, então continuam sempre ao vivo,
// via /api/meta/insights (sem cache) — o botão "Atualizar" do Monitor de
// CPA busca esses três direto na Meta.

import type { createClient } from "@/lib/supabase/server";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { getAccountsInsights } from "@/lib/meta/insights";
import { todayBrt } from "@/lib/meta/daily-range";

type Db = Awaited<ReturnType<typeof createClient>>;

export const CPA_BOARD_CACHEABLE_PRESETS = ["yesterday", "last_3d"] as const;
export type CpaBoardCachePreset = (typeof CPA_BOARD_CACHEABLE_PRESETS)[number];

export interface CpaBoardCacheEntry {
  spend: number;
  cost_per_result: number | null;
  results: number | null;
}

export interface CpaBoardCachePayload {
  computed_at: string; // ISO — pra mostrar "atualizado hoje às HH:mm" na tela
  computed_for?: string; // YYYY-MM-DD (Brasília) do dia em que foi calculado — "ontem" é sempre o dia anterior a esse
  insights: Record<string, CpaBoardCacheEntry>;
}

function cacheKey(preset: CpaBoardCachePreset): string {
  return `cpa_board:${preset}`;
}

export async function readCpaBoardCache(
  db: Db,
  userId: string,
  preset: CpaBoardCachePreset,
): Promise<CpaBoardCachePayload | null> {
  const { data, error } = await db
    .from("meta_insights_cache")
    .select("payload")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey(preset))
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as CpaBoardCachePayload | undefined) ?? null;
}

// O cache só vale no dia em que foi calculado: "Ontem" de um cálculo feito anteontem é OUTRO dia.
// (Antes a tela mostrava o que estivesse guardado, mesmo de um dia anterior.)
export function cpaBoardCacheIsCurrent(payload: CpaBoardCachePayload | null, now: Date = new Date()): boolean {
  if (!payload) return false;
  const day = payload.computed_for ?? todayBrt(new Date(payload.computed_at));
  return day === todayBrt(now);
}

// Recalcula o cache de um usuário (contas com CPA ideal, só clientes ativos) — usado pelo botão "Calcular agora"
// e pela abertura do Monitor quando o cache é de outro dia.
export async function refreshCpaBoardCacheForUser(db: Db, userId: string, token: string): Promise<number> {
  const { data: bindings, error } = await db
    .from("account_bindings")
    .select("ad_account_id")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (error) throw error;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (bindings ?? []).map((b) => b.ad_account_id as string).filter((id) => !off.has(id));
  await refreshCpaBoardCache(db, userId, token, accountIds);
  return accountIds.length;
}

// Chamado 1x por dia pelo hook cpa-board-cache-tick — recalcula os dois
// períodos fechados e substitui o cache inteiro (não é incremental).
export async function refreshCpaBoardCache(
  db: Db,
  userId: string,
  token: string,
  accountIds: string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  await Promise.all(
    CPA_BOARD_CACHEABLE_PRESETS.map(async (preset) => {
      // skipStore: direto da Meta (o mesmo número do Gerenciador), nunca do backup diário.
      const insightsByAccount = await getAccountsInsights(token, accountIds, preset, { skipStore: true });
      const insights: Record<string, CpaBoardCacheEntry> = {};
      for (const [accId, ins] of Object.entries(insightsByAccount)) {
        insights[accId] = { spend: ins.spend, cost_per_result: ins.cost_per_result, results: ins.results };
      }
      const payload: CpaBoardCachePayload = { computed_at: new Date().toISOString(), computed_for: todayBrt(), insights };
      const expiresAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
      const { error } = await db
        .from("meta_insights_cache")
        .upsert(
          { user_id: userId, cache_key: cacheKey(preset), payload, expires_at: expiresAt },
          { onConflict: "user_id,cache_key" },
        );
      if (error) throw error;
    }),
  );
}
