// Etapa 122: conferência DIRETA dos anúncios de um conjunto, usada antes de pausar "conjunto sem anúncio ativo"
// (verificação de 3 em 3 horas e Auditoria). Regra do Anderson: só pausa se o conjunto NÃO tem nenhum anúncio ativo
// E nenhum anúncio em qualquer outro status "vivo" (em análise, processando, pré-aprovado, com problemas, reprovado,
// pendência de cobrança…). Só contam como "desligados" os anúncios pausados, arquivados ou excluídos.
// Na dúvida (a Meta falhou, resposta incompleta) NÃO pausa.
import { metaGetAll } from "./client";

const DEAD_AD_STATUSES = new Set(["PAUSED", "ARCHIVED", "DELETED"]);

// Conjunto criado há menos que isso e ainda sem nenhum anúncio: pode estar no meio da criação (o anúncio sobe
// depois) — não pausa.
export const NEW_ADSET_GRACE_HOURS = 3;

export interface AdsetPauseCheck {
  safeToPause: boolean;
  // true = a conferência achou anúncio ATIVO (o campo aninhado da Meta tinha vindo vazio por engano).
  hasActive: boolean;
  reason: string;
}

export function isRecentlyCreated(createdTime: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdTime) return false;
  const ms = Date.parse(createdTime);
  if (Number.isNaN(ms)) return false;
  return now - ms < NEW_ADSET_GRACE_HOURS * 60 * 60 * 1000;
}

export function classifyAdsForPause(
  ads: Array<{ effective_status?: string }>,
  createdTime: string | null | undefined,
  now: number = Date.now(),
): AdsetPauseCheck {
  const statuses = ads.map((a) => String(a.effective_status ?? "").toUpperCase());
  const hasActive = statuses.includes("ACTIVE");
  const alive = [...new Set(statuses.filter((s) => !DEAD_AD_STATUSES.has(s)))];
  if (hasActive) return { safeToPause: false, hasActive: true, reason: "tem anúncio ativo" };
  if (alive.length > 0) {
    return { safeToPause: false, hasActive: false, reason: `tem anúncio em outro status (${alive.map((s) => s || "desconhecido").join(", ")})` };
  }
  if (ads.length === 0 && isRecentlyCreated(createdTime, now)) {
    return { safeToPause: false, hasActive: false, reason: `conjunto criado há menos de ${NEW_ADSET_GRACE_HOURS}h, ainda sem anúncio` };
  }
  return { safeToPause: true, hasActive: false, reason: ads.length === 0 ? "conjunto sem nenhum anúncio" : "todos os anúncios estão pausados ou arquivados" };
}

export async function checkAdsetSafeToPause(
  token: string,
  adsetId: string,
  createdTime?: string | null,
): Promise<AdsetPauseCheck> {
  try {
    const ads = await metaGetAll<{ id?: string; effective_status?: string }>(token, `/${adsetId}/ads`, {
      fields: "id,effective_status",
      limit: "200",
    });
    return classifyAdsForPause(ads, createdTime);
  } catch {
    return { safeToPause: false, hasActive: false, reason: "não consegui conferir os anúncios do conjunto na Meta" };
  }
}
