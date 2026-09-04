// Painel > Análise, a nível de conjunto — agrega os mesmos anúncios que
// getCreativeCostAnalysis já busca (custo por conversa iniciada), somando
// por conjunto, e só mantém conjunto ATIVO. Cada conjunto carrega também a
// lista dos próprios criativos (mesmos dados por anúncio), pra tela poder
// expandir sem precisar de uma segunda busca.
import { metaGetAll, type DateRangeInput } from "./client";
import { getCreativeCostAnalysis } from "./creative-analysis";

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
}

interface AdSetStatusRow {
  id?: string;
  effective_status?: string;
  status?: string;
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
      fields: "id,effective_status,status",
      limit: "500",
    }).catch((e) => {
      console.error("adset analysis status err (non-fatal)", id, e);
      return [] as AdSetStatusRow[];
    }),
  ]);

  const adsetStatusMap = new Map<string, string>();
  for (const a of adsetStatusRows) {
    if (a.id) adsetStatusMap.set(a.id, (a.effective_status || a.status || "").toUpperCase());
  }

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
  for (const g of groups.values()) {
    if (adsetStatusMap.get(g.id) !== "ACTIVE") continue; // só conjunto ativo, pedido explícito
    g.cost_per_conversation = g.conversations && g.conversations > 0 ? g.spend / g.conversations : null;
    result.push(g);
  }
  return result;
}
