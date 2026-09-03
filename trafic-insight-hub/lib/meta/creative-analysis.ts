// Análise de custo por conversa iniciada (Mensagens/WhatsApp click-to-chat)
// por criativo — usado pela aba Painel > Análise.
//
// ⚠️ O nome exato do action_type de "conversa iniciada" no Graph API varia
// um pouco conforme a janela de atribuição da conta (ex.:
// "onsite_conversion.messaging_conversation_started_7d"). Em vez de travar
// num nome fixo, casamos qualquer action_type que contenha
// "messaging_conversation_started" — mais robusto, mas vale conferir com um
// anúncio real se os números baterem com o Gerenciador de Anúncios.

import { metaGetAll, presetParams, type DateRangeInput } from "./client";
import { isVaga, EXCLUDED_OBJECTIVES } from "./shared";

export interface CreativeCostRow {
  id: string;
  name: string;
  adset_id: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
  status: string | null;
}

type ActionRow = { action_type?: string; value?: string };

interface AdInsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  actions?: ActionRow[];
  cost_per_action_type?: ActionRow[];
}

interface AdStatusRow {
  id?: string;
  effective_status?: string;
  status?: string;
}

interface CampaignRow {
  id?: string;
  objective?: string;
}

function isMessagingConversationAction(type?: string): boolean {
  return !!type && type.includes("messaging_conversation_started");
}

export async function getCreativeCostAnalysis(
  token: string,
  accountId: string,
  datePreset: DateRangeInput,
): Promise<CreativeCostRow[]> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

  const [insightRows, adStatusRows, campaignRows] = await Promise.all([
    metaGetAll<AdInsightRow>(token, `/${id}/insights`, {
      fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,actions,cost_per_action_type",
      ...presetParams(datePreset),
      level: "ad",
      limit: "500",
      use_unified_attribution_setting: "true",
    }),
    metaGetAll<AdStatusRow>(token, `/${id}/ads`, {
      fields: "id,effective_status,status",
      limit: "500",
    }).catch((e) => {
      console.error("creative analysis status err (non-fatal)", id, e);
      return [] as AdStatusRow[];
    }),
    metaGetAll<CampaignRow>(token, `/${id}/campaigns`, {
      fields: "id,objective",
      limit: "500",
    }).catch((e) => {
      console.error("creative analysis campaigns err (non-fatal)", id, e);
      return [] as CampaignRow[];
    }),
  ]);

  const statusMap = new Map<string, string>();
  for (const a of adStatusRows) {
    if (a.id) statusMap.set(a.id, a.effective_status || a.status || "");
  }

  // Campanhas de objetivo Tráfego/Reconhecimento/Engajamento etc. (não é o
  // tipo de resultado que o gestor acompanha aqui) — mesma regra usada em
  // Acompanhamento e Evolução, agora também em Análise.
  const excludedObjectiveIds = new Set<string>();
  for (const c of campaignRows) {
    if (c.id && c.objective && EXCLUDED_OBJECTIVES.has(c.objective)) excludedObjectiveIds.add(c.id);
  }

  const rows: CreativeCostRow[] = [];
  for (const row of insightRows) {
    if (!row.ad_id) continue;
    if (isVaga(row.campaign_name)) continue;
    if (row.campaign_id && excludedObjectiveIds.has(row.campaign_id)) continue;

    // Devolve o status de todo criativo (ativo ou pausado) — quem decide
    // quais status entram na lista final é a rota (app/api/analysis/creatives),
    // conforme o filtro escolhido na tela (Ativos é o padrão fixo).
    const status = statusMap.get(row.ad_id) ?? null;

    const spend = row.spend ? Number(row.spend) : 0;
    if (spend <= 0) continue; // sem gasto não há o que avaliar

    const costEntry = (row.cost_per_action_type ?? []).find((a) => isMessagingConversationAction(a.action_type));
    const actionEntry = (row.actions ?? []).find((a) => isMessagingConversationAction(a.action_type));
    const conversations = actionEntry?.value ? Number(actionEntry.value) : null;

    let costPerConversation = costEntry?.value ? Number(costEntry.value) : null;
    if (costPerConversation == null && conversations && conversations > 0) {
      costPerConversation = spend / conversations;
    }
    // Ao contrário de antes, NÃO pula mais quando não há conversa iniciada
    // (cost_per_conversation fica null) — é justamente o outro caso que a
    // Análise precisa sinalizar: gasto alto sem nenhuma conversa iniciada.
    // Quem decide o que entra na lista final é a rota (app/api/analysis/creatives).

    rows.push({
      id: row.ad_id,
      name: row.ad_name || row.ad_id,
      adset_id: row.adset_id ?? null,
      adset_name: row.adset_name ?? null,
      campaign_name: row.campaign_name ?? null,
      spend,
      conversations,
      cost_per_conversation: costPerConversation,
      status,
    });
  }
  return rows;
}
