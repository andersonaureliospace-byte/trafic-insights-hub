// Auditoria de Erros de veiculação — portado do app anterior
// (audit-errors.server.ts). Considera só campanhas/conjuntos ativos:
// anúncios reprovados/restritos/em análise, e conjuntos ativos sem nenhum
// anúncio ativo.
// Etapa 122: SÓ o caso "conjunto sem anúncio ativo" gera pausa (e só depois de conferir DIRETO os anúncios do
// conjunto: se tiver qualquer anúncio ativo ou em outro status vivo — análise, processando, reprovado… —, ou o
// conjunto for novo e ainda sem anúncio, não pausa). Anúncio com erro/em análise só é REGISTRADO como aviso
// (entity_type "ad"); o conjunto dele não é pausado.

import { metaGetAll } from "@/lib/meta/client";
import { adsetSpendTodayYesterday, checkAdsetSafeToPause, isRecentlyCreated } from "@/lib/meta/adset-ads-check";

export interface AuditErrorIssue {
  entity_id: string;
  entity_name: string;
  entity_type: "ad" | "adset";
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  reasons: string[];
  // Etapa 174: preenchido = o problema é só avisado, o conjunto NÃO é pausado (ex.: "sem gasto de ontem pra hoje").
  hold?: string;
}

const AD_ERROR_STATUSES: Record<string, string> = {
  DISAPPROVED: "Anúncio reprovado",
  WITH_ISSUES: "Anúncio com problemas",
  PENDING_REVIEW: "Anúncio em análise",
  PENDING_BILLING_INFO: "Pendência de cobrança",
  PREAPPROVED: "Anúncio pré-aprovado (em análise)",
};

interface AdRow {
  id: string;
  name?: string;
  effective_status?: string;
  issues_info?: Array<{ error_summary?: string; error_message?: string }>;
  adset?: { id?: string; name?: string; effective_status?: string };
  campaign?: { id?: string; name?: string; effective_status?: string };
}

interface AdsetRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  end_time?: string;
  created_time?: string;
  campaign?: { name?: string; effective_status?: string };
  ads?: { data?: Array<{ id: string }> };
}

export async function auditAccountErrors(
  token: string,
  adAccountId: string,
): Promise<{ issues: AuditErrorIssue[]; checked: number }> {
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const issues: AuditErrorIssue[] = [];
  const now = Date.now();

  // 1) Anúncios com erro/restrição dentro de campanhas e conjuntos ativos.
  const ads = await metaGetAll<AdRow>(
    token,
    `/${actId}/ads`,
    {
      fields:
        "id,name,effective_status,issues_info{error_summary,error_message},adset{id,name,effective_status},campaign{id,name,effective_status}",
      effective_status: JSON.stringify([
        "DISAPPROVED",
        "WITH_ISSUES",
        "PENDING_REVIEW",
        "PENDING_BILLING_INFO",
        "PREAPPROVED",
      ]),
      limit: "200",
    },
    5,
  );
  for (const ad of ads) {
    if (String(ad.campaign?.effective_status ?? "").toUpperCase() !== "ACTIVE") continue;
    if (String(ad.adset?.effective_status ?? "").toUpperCase() !== "ACTIVE") continue;
    const status = String(ad.effective_status ?? "").toUpperCase();
    const label = AD_ERROR_STATUSES[status];
    if (!label) continue;
    const details = (ad.issues_info ?? [])
      .map((i) => i.error_summary || i.error_message || "")
      .filter(Boolean)
      .slice(0, 3);
    issues.push({
      entity_id: ad.id,
      entity_name: ad.name || ad.id,
      entity_type: "ad",
      campaign_name: ad.campaign?.name ?? null,
      adset_id: ad.adset?.id ?? null,
      adset_name: ad.adset?.name ?? null,
      reasons: [label, ...details],
    });
  }

  // 2) Conjuntos ativos (campanha ativa) sem nenhum anúncio ativo.
  const adsets = await metaGetAll<AdsetRow>(
    token,
    `/${actId}/adsets`,
    {
      fields:
        "id,name,status,effective_status,end_time,created_time,campaign{name,effective_status},ads.effective_status(['ACTIVE']).limit(1){id}",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: "200",
    },
    5,
  );
  let checked = 0;
  for (const row of adsets) {
    if (String(row.status ?? "").toUpperCase() !== "ACTIVE") continue;
    if (String(row.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if (String(row.campaign?.effective_status ?? "").toUpperCase() !== "ACTIVE") continue;
    if (row.end_time && new Date(row.end_time).getTime() <= now) continue;
    checked++;
    if ((row.ads?.data?.length ?? 0) === 0) {
      // Confere direto na Meta antes de acusar (e pausar): só vale se não há nenhum anúncio "vivo".
      const check = await checkAdsetSafeToPause(token, row.id, row.created_time);
      if (!check.safeToPause) continue;
      // Etapa 174: conjunto sem anúncio ativo que NÃO gastou de ontem pra hoje (ou cujo gasto não deu pra conferir) não é pausado.
      // Conjunto novo nessa situação (provavelmente em montagem) nem é avisado; os mais velhos aparecem só como aviso.
      const spend = await adsetSpendTodayYesterday(token, row.id);
      const noSpend = spend == null || spend <= 0;
      if (noSpend && isRecentlyCreated(row.created_time, now)) continue;
      issues.push({
        hold: noSpend ? (spend == null ? "não consegui conferir o gasto" : "sem gasto de ontem pra hoje") : undefined,
        entity_id: row.id,
        entity_name: row.name || row.id,
        entity_type: "adset",
        campaign_name: row.campaign?.name ?? null,
        adset_id: row.id,
        adset_name: null,
        reasons: ["Conjunto ativo sem anúncio ativo"],
      });
    }
  }

  return { issues, checked: checked + ads.length };
}
