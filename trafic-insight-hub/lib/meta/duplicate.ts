// Duplicar conjunto (Etapa 159) — botão "Duplicar" em Painel > Análise > CPA abaixo da meta.
//
// Passo a passo (cada passo usa o comando de cópia da Graph API, um objeto por vez — mais fácil de diagnosticar que a cópia profunda):
//   1) copia o CONJUNTO (POST /{adset}/copies, deep_copy=false, nasce PAUSADO, na mesma campanha, sem renomear);
//   2) acerta o nome (data de hoje no lugar da data antiga) e, se pedido, o orçamento diário;
//   3) copia só os CRIATIVOS escolhidos pra dentro do conjunto novo (POST /{ad}/copies com adset_id) — herdam o status do original,
//      então quando o conjunto for ativado os criativos já estão ativos;
//   4) tira qualquer "Cópia/Copy" que a Meta ainda tenha deixado nos nomes dos criativos (padrão de nomes: "Cópia" não pode aparecer).
// Qualquer falha devolve a mensagem exata da Meta (é o objetivo: descobrir por que a duplicação dá erro). O que já foi criado fica
// — o resultado diz o que deu certo e o que não deu.

import { metaGet, metaGetAll, metaPost } from "./client";
import { getAdSetBudgetInfo } from "./budget";
import { brtDayMonth, hasCopy, stripCopy } from "@/lib/naming/rules";

const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });
const DELAY_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Troca todo "dd/mm" do nome pela data de hoje (Brasília). Sem data no nome: devolve igual.
export function withTodayDate(name: string, now: Date = new Date()): string {
  const today = brtDayMonth(now.toISOString());
  if (!today) return name;
  return name.replace(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\b/g, today);
}

export interface DuplicateInfo {
  adsetName: string;
  suggestedName: string;
  campaignId: string | null;
  // Orçamento diário do próprio conjunto (ABO). null = sem orçamento no conjunto (CBO ou vitalício): a cópia herda e não dá pra mudar aqui.
  dailyBudget: number | null;
  budgetNote: string | null;
  ads: Array<{ id: string; name: string; status: string }>;
}

interface AdsetFields {
  name?: string;
  campaign_id?: string;
}

export async function getDuplicateInfo(token: string, adsetId: string): Promise<DuplicateInfo> {
  const adset = await metaGet<AdsetFields>(token, `/${adsetId}`, { fields: "name,campaign_id" });
  const ads = await metaGetAll<{ id?: string; name?: string; effective_status?: string }>(token, `/${adsetId}/ads`, {
    fields: "id,name,effective_status",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "100",
  });
  const budget = await getAdSetBudgetInfo(token, adsetId);
  let dailyBudget: number | null = null;
  let budgetNote: string | null = null;
  if (budget.ok) {
    if (budget.info.scope === "adset") dailyBudget = budget.info.currentCents / 100;
    else budgetNote = "O orçamento está na campanha (CBO): a cópia usa o da campanha e não dá pra mudar aqui.";
  } else {
    budgetNote = budget.error;
  }
  const name = adset.name ?? adsetId;
  return {
    adsetName: name,
    suggestedName: withTodayDate(name),
    campaignId: adset.campaign_id ?? null,
    dailyBudget,
    budgetNote,
    ads: ads.filter((a) => a.id).map((a) => ({ id: a.id as string, name: a.name ?? (a.id as string), status: (a.effective_status ?? "").toUpperCase() })),
  };
}

export interface DuplicateResult {
  ok: boolean;
  newAdsetId?: string;
  newName?: string;
  copiedAds: Array<{ sourceId: string; newId: string | null }>;
  failedAds: Array<{ id: string; name: string; error: string }>;
  warnings: string[];
  error?: string; // falha na cópia do conjunto (nada foi criado)
}

interface CopyResponse {
  copied_adset_id?: string;
  copied_ad_id?: string;
  ad_object_ids?: Array<{ ad_object_type?: string; source_id?: string; copied_id?: string }>;
}

export async function duplicateAdSet(
  token: string,
  p: { adsetId: string; adIds: Array<{ id: string; name: string }>; newName: string; dailyBudgetCents?: number | null },
): Promise<DuplicateResult> {
  const out: DuplicateResult = { ok: false, copiedAds: [], failedAds: [], warnings: [] };

  // 1) o conjunto
  let newId: string | null = null;
  try {
    const info = await metaGet<AdsetFields>(token, `/${p.adsetId}`, { fields: "campaign_id" });
    const params: Record<string, string> = { deep_copy: "false", status_option: "PAUSED", rename_options: NO_RENAME };
    if (info.campaign_id) params.campaign_id = info.campaign_id;
    const res = await metaPost<CopyResponse>(token, `/${p.adsetId}/copies`, params);
    newId = res.copied_adset_id ?? res.ad_object_ids?.find((o) => o.ad_object_type === "ad_set")?.copied_id ?? res.ad_object_ids?.[0]?.copied_id ?? null;
  } catch (e) {
    out.error = `Não consegui copiar o conjunto: ${(e as Error).message}`;
    return out;
  }
  if (!newId) {
    out.error = "A Meta respondeu sem o id do conjunto novo. Confira no Gerenciador se a cópia foi criada.";
    return out;
  }
  out.newAdsetId = newId;

  // 2) nome e orçamento
  try {
    const patch: Record<string, string> = { name: p.newName };
    if (p.dailyBudgetCents != null && p.dailyBudgetCents > 0) patch.daily_budget = String(Math.round(p.dailyBudgetCents));
    await metaPost(token, `/${newId}`, patch);
    out.newName = p.newName;
  } catch (e) {
    out.warnings.push(`Conjunto criado, mas não consegui acertar nome/orçamento: ${(e as Error).message}`);
  }

  // 3) os criativos escolhidos
  for (let i = 0; i < p.adIds.length; i++) {
    const ad = p.adIds[i];
    try {
      const res = await metaPost<CopyResponse>(token, `/${ad.id}/copies`, {
        adset_id: newId,
        status_option: "INHERITED_FROM_SOURCE",
        rename_options: NO_RENAME,
      });
      const copied = res.copied_ad_id ?? res.ad_object_ids?.find((o) => o.ad_object_type === "ad")?.copied_id ?? res.ad_object_ids?.[0]?.copied_id ?? null;
      out.copiedAds.push({ sourceId: ad.id, newId: copied });
    } catch (e) {
      out.failedAds.push({ id: ad.id, name: ad.name, error: (e as Error).message });
    }
    if (i < p.adIds.length - 1) await sleep(DELAY_MS);
  }

  // 4) "Cópia/Copy" nos nomes dos criativos novos
  try {
    const created = await metaGetAll<{ id?: string; name?: string }>(token, `/${newId}/ads`, { fields: "id,name", limit: "100" });
    const sourceNames = new Set(p.adIds.map((x) => x.name));
    for (const a of created) {
      if (!a.id || !a.name) continue;
      if (sourceNames.has(a.name) || !hasCopy(a.name)) continue; // já está igual ao original: não mexe
      const clean = stripCopy(a.name);
      if (clean && clean !== a.name) await metaPost(token, `/${a.id}`, { name: clean });
    }
  } catch (e) {
    out.warnings.push(`Não consegui conferir os nomes dos criativos novos: ${(e as Error).message}`);
  }

  out.ok = true;
  return out;
}
