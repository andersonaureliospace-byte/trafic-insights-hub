// Etapa 195: anúncios com VÁRIAS mídias dentro do mesmo anúncio (formato flexível / Advantage+ criativo: até 10 vídeos/imagens num
// anúncio só). A Meta distribui o gasto entre as mídias por conta própria (muitas vezes quase tudo numa só), então o custo por
// conversa do ANÚNCIO não diz qual mídia é boa ou ruim — e pausar o anúncio/conjunto por esse número pode jogar fora a mídia certa.
// Por decisão do usuário (22/10/2026), as pausas automáticas NÃO mexem nesses anúncios nem nos conjuntos que os têm, por enquanto.
//
// Como identifica: creative.asset_feed_spec tem mais de 1 item entre `videos` + `images`.
// Se a Meta recusar a consulta, devolve vazio (as automações seguem como antes) e registra no log — nunca derruba a rotina.

import { metaGetAll } from "./client";
import { memoMeta, tokenTag } from "./memo";

interface AdFeedRow {
  id?: string;
  adset_id?: string;
  creative?: { asset_feed_spec?: { videos?: unknown[]; images?: unknown[] } };
}

export interface MultiMediaAds {
  adIds: Set<string>;
  adsetIds: Set<string>;
}

export async function getMultiMediaAds(token: string, accountId: string): Promise<MultiMediaAds> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  try {
    return await memoMeta(`multi-media:${tokenTag(token)}:${id}`, 120_000, async () => {
      const rows = await metaGetAll<AdFeedRow>(
        token,
        `/${id}/ads`,
        {
          fields: "id,adset_id,creative{asset_feed_spec}",
          effective_status: JSON.stringify(["ACTIVE"]),
          limit: "200",
        },
        5,
      );
      const adIds = new Set<string>();
      const adsetIds = new Set<string>();
      for (const r of rows) {
        const spec = r.creative?.asset_feed_spec;
        const n = (spec?.videos?.length ?? 0) + (spec?.images?.length ?? 0);
        if (r.id && n > 1) {
          adIds.add(r.id);
          if (r.adset_id) adsetIds.add(r.adset_id);
        }
      }
      return { adIds, adsetIds } satisfies MultiMediaAds;
    });
  } catch (e) {
    console.error("multi-media err (segue sem essa trava)", id, (e as Error).message?.slice(0, 160));
    return { adIds: new Set<string>(), adsetIds: new Set<string>() };
  }
}
