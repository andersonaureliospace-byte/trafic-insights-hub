// Painel > Análise, a nível de conjunto — agrega os mesmos anúncios que
// getCreativeCostAnalysis já busca (custo por conversa iniciada), somando
// por conjunto, e só mantém conjunto ATIVO. Cada conjunto carrega também a
// lista dos próprios criativos (mesmos dados por anúncio), pra tela poder
// expandir sem precisar de uma segunda busca.
import { metaGetAll, type DateRangeInput } from "./client";
import { getCreativeCostAnalysis } from "./creative-analysis";
import { checkAdsetSafeToPause } from "./adset-ads-check";

export interface AdSetCreativeRow {
  id: string;
  name: string;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
}

export interface AdSetCostRow {
  id: string;
  name: string;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  ads: AdSetCreativeRow[];
  // Etapa 46: conjunto ATIVO mas sem nenhum anúncio ATIVO dentro dele (mesma
  // checagem que a Auditoria já fazia em lib/audit/errors.ts, agora também
  // disponível pra Análise > Conjuntos sinalizar).
  has_active_ad: boolean;
  // Etapa 104/122: conjunto sem anúncio ATIVO que NÃO deve ser pausado automaticamente: tem anúncio em
  // QUALQUER outro status que não seja pausado/arquivado/excluído (em análise, processando, pré-aprovado,
  // com problemas, reprovado, cobrança…), ou foi criado há menos de 3h e ainda não tem anúncio, ou a
  // conferência na Meta falhou (na dúvida, não pausa). Só é calculado quando o conjunto está sem anúncio ativo.
  has_pending_ad?: boolean;
}

interface AdSetStatusRow {
  id?: string;
  name?: string;
  effective_status?: string;
  status?: string;
  campaign?: { name?: string };
  created_time?: string;
  // Filtro de edge do Graph API: só traz até 1 anúncio ATIVO — usado só pra
  // saber se existe pelo menos um (ads.data.length > 0), sem precisar buscar
  // todos os anúncios do conjunto de novo.
  ads?: { data?: { id?: string }[] };
}

export async function getAdSetCostAnalysis(
  token: string,
  accountId: string,
  datePreset: DateRangeInput,
): Promise<AdSetCostRow[]> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

  const [adRows, adsetStatusRows] = await Promise.all([
    getCreativeCostAnalysis(token, accountId, datePreset),
    metaGetAll<AdSetStatusRow>(token, `/${id}/adsets`, {
      fields: "id,name,effective_status,status,created_time,campaign{name},ads.effective_status(['ACTIVE']).limit(1){id}",
      limit: "500",
    }).catch((e) => {
      console.error("adset analysis status err (non-fatal)", id, e);
      return [] as AdSetStatusRow[];
    }),
  ]);

  const adsetInfoMap = new Map<
    string,
    { name: string; campaignName: string | null; effectiveStatus: string; hasActiveAd: boolean; createdTime: string | null }
  >();
  for (const a of adsetStatusRows) {
    if (!a.id) continue;
    adsetInfoMap.set(a.id, {
      name: a.name || a.id,
      campaignName: a.campaign?.name ?? null,
      effectiveStatus: (a.effective_status || a.status || "").toUpperCase(),
      hasActiveAd: (a.ads?.data?.length ?? 0) > 0,
      createdTime: a.created_time ?? null,
    });
  }

  // Etapa 122: pra todo conjunto ATIVO que veio "sem anúncio ativo", confere DIRETO os anúncios dele na Meta
  // antes de qualquer pausa (o campo aninhado acima pode vir vazio por falha da Meta). Se achar anúncio
  // ativo, corrige; se achar anúncio em outro status vivo, conjunto novo sem anúncio ou falhar, marca
  // "não pausar" (has_pending_ad).
  const noPause = new Set<string>();
  for (const [adsetId, info] of adsetInfoMap) {
    if (info.effectiveStatus !== "ACTIVE" || info.hasActiveAd) continue;
    const check = await checkAdsetSafeToPause(token, adsetId, info.createdTime);
    if (check.hasActive) info.hasActiveAd = true;
    else if (!check.safeToPause) noPause.add(adsetId);
  }
  const hasPending = (adsetId: string, hasActiveAd: boolean): boolean => !hasActiveAd && noPause.has(adsetId);

  const groups = new Map<string, AdSetCostRow>();
  for (const ad of adRows) {
    if (!ad.adset_id) continue;
    let g = groups.get(ad.adset_id);
    if (!g) {
      g = {
        id: ad.adset_id,
        name: ad.adset_name || ad.adset_id,
        campaign_name: ad.campaign_name,
        spend: 0,
        conversations: null,
        cost_per_conversation: null,
        ads: [],
        has_active_ad: true,
      };
      groups.set(ad.adset_id, g);
    }
    g.spend += ad.spend;
    if (ad.conversations != null) {
      g.conversations = (g.conversations ?? 0) + ad.conversations;
    }
    g.ads.push({
      id: ad.id,
      name: ad.name,
      spend: ad.spend,
      conversations: ad.conversations,
      cost_per_conversation: ad.cost_per_conversation,
      status: ad.status,
    });
  }

  const result: AdSetCostRow[] = [];
  const includedIds = new Set<string>();
  for (const g of groups.values()) {
    const info = adsetInfoMap.get(g.id);
    if (info?.effectiveStatus !== "ACTIVE") continue; // só conjunto ativo, pedido explícito
    g.cost_per_conversation = g.conversations && g.conversations > 0 ? g.spend / g.conversations : null;
    g.has_active_ad = info.hasActiveAd;
    g.has_pending_ad = hasPending(g.id, info.hasActiveAd);
    result.push(g);
    includedIds.add(g.id);
  }

  // Etapa 46: conjunto ATIVO sem nenhum anúncio ativo E sem gasto no período
  // (por isso nem apareceu nos ads acima, que só contam anúncio com gasto>0)
  // — cria uma entrada "vazia" só pra avisar, já que sem isso esse conjunto
  // nunca chegaria na tela de jeito nenhum.
  for (const [adsetId, info] of adsetInfoMap) {
    if (includedIds.has(adsetId)) continue;
    if (info.effectiveStatus !== "ACTIVE") continue;
    if (info.hasActiveAd) continue;
    result.push({
      id: adsetId,
      name: info.name,
      campaign_name: info.campaignName,
      spend: 0,
      conversations: null,
      cost_per_conversation: null,
      ads: [],
      has_active_ad: false,
      has_pending_ad: hasPending(adsetId, false),
    });
  }

  return result;
}
