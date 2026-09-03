// Painel > Análise: "recriar conjunto" — usado quando um criativo estoura o
// CPA e, além de pausar o criativo, o gestor também quer "resetar" o
// conjunto inteiro (fadiga de público/criativo) em vez de só remover o
// anúncio do conjunto existente.
//
// Fluxo (pedido explícito, Etapa 28): pausa o criativo ruim, pausa o
// conjunto original, duplica o conjunto (mesma segmentação/otimização/lance,
// mesma campanha CBO) com TODOS os anúncios originais — inclusive o que
// acabou de ser pausado — e deixa a cópia pausada (rascunho). A partir daí é
// manual: o gestor abre o Gerenciador de Anúncios, exclui o criativo
// pausado da cópia, ativa o conjunto novo e publica.
//
// ⚠️ Isso reproduz o botão "Duplicar" do Gerenciador de Anúncios via
// chamadas cruas da Graph API — a segmentação (targeting), meta de
// otimização, evento de cobrança, estratégia de lance e afins são copiados
// tal como a Meta devolve na leitura. Campos exóticos (regras de DSA por
// região, agendamento por horário, criativo dinâmico) só são incluídos
// quando a Meta os retorna no conjunto de origem. Vale testar num conjunto
// de baixo risco antes de confiar nisso no dia a dia.
import { metaGet, metaGetAll, metaPost } from "./client";
import { setEntitiesStatus } from "./status";

// Todas as contas usam CBO com um teto de gasto de R$ 15 por conjunto — fixo
// por pedido explícito, não precisa copiar/calcular o valor do conjunto de
// origem.
const FIXED_DAILY_SPEND_CAP_CENTS = "1500";

export interface RefreshAdSetResult {
  newAdSetId: string;
  createdAdIds: string[];
  adErrors: { adId: string; error: string }[];
}

interface AdSetConfig {
  name?: string;
  campaign_id?: string;
  targeting?: unknown;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: number;
  promoted_object?: unknown;
  attribution_spec?: unknown[];
  destination_type?: string;
  is_dynamic_creative?: boolean;
  frequency_control_specs?: unknown[];
  dsa_beneficiary?: string;
  dsa_payor?: string;
  optimization_sub_event?: string;
}

interface SourceAdRow {
  id?: string;
  name?: string;
  creative?: { id?: string };
}

export async function pauseAndDuplicateAdSet(
  token: string,
  adId: string,
  adsetId: string,
): Promise<RefreshAdSetResult> {
  // 1) Pausa o criativo ruim + o conjunto original. Se qualquer um dos dois
  // falhar, para aqui — não faz sentido duplicar um conjunto que não
  // conseguimos nem pausar.
  const pauseResults = await setEntitiesStatus(
    token,
    [
      { id: adId, type: "ad" },
      { id: adsetId, type: "adset" },
    ],
    "PAUSED",
  );
  const failed = pauseResults.find((r) => !r.ok);
  if (failed) {
    throw new Error(`Não consegui pausar antes de duplicar: ${failed.error}`);
  }

  // 2) Lê a config completa do conjunto original.
  const config = await metaGet<AdSetConfig>(token, `/${adsetId}`, {
    fields:
      "name,campaign_id,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,promoted_object,attribution_spec,destination_type,is_dynamic_creative,frequency_control_specs,dsa_beneficiary,dsa_payor,optimization_sub_event",
  });
  if (!config.campaign_id) {
    throw new Error("Não encontrei a campanha desse conjunto — o conjunto já foi pausado, mas não deu pra duplicar.");
  }

  // 3) Monta os parâmetros do conjunto novo — só inclui o que a Meta
  // realmente devolveu (campo ausente/indefinido não entra, pra não mandar
  // combinação inválida pra API).
  const createParams: Record<string, string> = {
    name: `${config.name ?? "Conjunto"} (cópia)`,
    campaign_id: config.campaign_id,
    status: "PAUSED",
    daily_spend_cap: FIXED_DAILY_SPEND_CAP_CENTS,
  };
  if (config.targeting) createParams.targeting = JSON.stringify(config.targeting);
  if (config.optimization_goal) createParams.optimization_goal = config.optimization_goal;
  if (config.billing_event) createParams.billing_event = config.billing_event;
  if (config.bid_strategy) createParams.bid_strategy = config.bid_strategy;
  if (config.bid_amount != null) createParams.bid_amount = String(config.bid_amount);
  if (config.promoted_object) createParams.promoted_object = JSON.stringify(config.promoted_object);
  if (config.attribution_spec) createParams.attribution_spec = JSON.stringify(config.attribution_spec);
  if (config.destination_type) createParams.destination_type = config.destination_type;
  if (config.is_dynamic_creative != null) createParams.is_dynamic_creative = String(config.is_dynamic_creative);
  if (config.frequency_control_specs) {
    createParams.frequency_control_specs = JSON.stringify(config.frequency_control_specs);
  }
  if (config.dsa_beneficiary) createParams.dsa_beneficiary = config.dsa_beneficiary;
  if (config.dsa_payor) createParams.dsa_payor = config.dsa_payor;
  if (config.optimization_sub_event) createParams.optimization_sub_event = config.optimization_sub_event;

  const created = await metaPost<{ id?: string }>(token, `/${config.campaign_id}/adsets`, createParams);
  const newAdSetId = created.id;
  if (!newAdSetId) {
    throw new Error("O conjunto original foi pausado, mas a Meta não retornou o ID do conjunto novo.");
  }

  // 4) Todos os anúncios do conjunto original — inclusive o que acabou de
  // ser pausado, por pedido explícito. A exclusão dele na cópia fica manual.
  const sourceAds = await metaGetAll<SourceAdRow>(token, `/${adsetId}/ads`, {
    fields: "id,name,creative{id}",
    limit: "500",
  });

  const createdAdIds: string[] = [];
  const adErrors: { adId: string; error: string }[] = [];
  for (const a of sourceAds) {
    if (!a.id || !a.creative?.id) continue;
    try {
      const newAd = await metaPost<{ id?: string }>(token, `/${newAdSetId}/ads`, {
        name: a.name ?? a.id,
        status: "PAUSED",
        creative: JSON.stringify({ creative_id: a.creative.id }),
      });
      if (newAd.id) createdAdIds.push(newAd.id);
    } catch (e) {
      adErrors.push({ adId: a.id, error: (e as Error).message });
    }
  }

  return { newAdSetId, createdAdIds, adErrors };
}
