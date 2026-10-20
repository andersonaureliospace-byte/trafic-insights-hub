// Regra pura do backup das pausas (Etapa 158) — sem Meta nem banco, testável. Ver lib/alerts/pause-backup.ts.
import { ADSET_CUT_EXTRA, isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";

export interface Now {
  spend: number;
  conversations: number;
  cpa: number | null;
}

// Regra pura: reativa?
export function shouldReactivate(entry: { entity_type: "adset" | "ad"; conversations_at_pause: number | null; cpa_at_pause: number | null }, now: Now, cpaTarget: number): boolean {
  const convBefore = entry.conversations_at_pause ?? 0;
  if (now.conversations <= convBefore) return false; // nada novo foi atribuído
  if (now.cpa == null) return false;
  if (entry.cpa_at_pause != null && now.cpa >= entry.cpa_at_pause) return false; // custo não caiu
  if (entry.entity_type === "ad") {
    return !isCreativeFlaggedAbove({ spend: now.spend, conversations: now.conversations, cost_per_conversation: now.cpa } as Parameters<typeof isCreativeFlaggedAbove>[0], cpaTarget);
  }
  return now.cpa < cpaTarget + ADSET_CUT_EXTRA;
}

