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
import { getAccountsInsights } from "@/lib/meta/insights";

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
      const insightsByAccount = await getAccountsInsights(token, accountIds, preset);
      const insights: Record<string, CpaBoardCacheEntry> = {};
      for (const [accId, ins] of Object.entries(insightsByAccount)) {
        insights[accId] = { spend: ins.spend, cost_per_result: ins.cost_per_result, results: ins.results };
      }
      const payload: CpaBoardCachePayload = { computed_at: new Date().toISOString(), insights };
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
