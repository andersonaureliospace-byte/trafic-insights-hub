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
  // Etapa 231: idade e WhatsApp do conjunto modelo (o novo herda; idade dá pra mudar).
  ageMin: number | null;
  ageMax: number | null;
  whatsapp: string | null;
}

interface AdsetFields {
  name?: string;
  campaign_id?: string;
  targeting?: { age_min?: number; age_max?: number };
  promoted_object?: { whatsapp_phone_number?: string };
}

export async function getDuplicateInfo(token: string, adsetId: string): Promise<DuplicateInfo> {
  const adset = await metaGet<AdsetFields>(token, `/${adsetId}`, { fields: "name,campaign_id,targeting{age_min,age_max},promoted_object" });
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
    ageMin: adset.targeting?.age_min ?? null,
    ageMax: adset.targeting?.age_max ?? null,
    whatsapp: adset.promoted_object?.whatsapp_phone_number ?? null,
    ads: ads.filter((a) => a.id).map((a) => ({ id: a.id as string, name: a.name ?? (a.id as string), status: (a.effective_status ?? "").toUpperCase() })),
  };
}

// Etapa 159b: a cópia nativa da Meta (/copies) recusa conjuntos de conversas com "The click attribution window is optional…
// use one of these supported windows: 1 days" — ela reaplica a janela de atribuição padrão (7 dias de clique) que não vale pra esse
// objetivo. Nesse caso o conjunto é CRIADO a partir dos dados do original, já com a janela certa (1 dia de clique).
const ATTRIBUTION_ERR = /attribution window/i;
const FALLBACK_ATTRIBUTION = JSON.stringify([{ event_type: "CLICK_THROUGH", window_days: 1 }]);

interface FullAdset {
  account_id?: string;
  campaign_id?: string;
  daily_budget?: string;
  billing_event?: string;
  optimization_goal?: string;
  bid_strategy?: string;
  bid_amount?: string;
  promoted_object?: unknown;
  targeting?: unknown;
  destination_type?: string;
  is_dynamic_creative?: boolean;
  pacing_type?: string[];
  dsa_beneficiary?: string;
  dsa_payor?: string;
}

async function createAdsetFromOriginal(token: string, adsetId: string, newName: string, budgetCents?: number | null): Promise<string> {
  const o = await metaGet<FullAdset>(token, `/${adsetId}`, {
    fields:
      "account_id,campaign_id,daily_budget,billing_event,optimization_goal,bid_strategy,bid_amount,promoted_object,targeting,destination_type,is_dynamic_creative,pacing_type,dsa_beneficiary,dsa_payor",
  });
  if (!o.account_id) throw new Error("A Meta não devolveu a conta do conjunto original.");
  const params: Record<string, string> = {
    name: newName,
    status: "PAUSED",
    attribution_spec: FALLBACK_ATTRIBUTION,
  };
  const put = (k: string, v: unknown) => {
    if (v == null || v === "") return;
    params[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  put("campaign_id", o.campaign_id);
  put("billing_event", o.billing_event);
  put("optimization_goal", o.optimization_goal);
  put("bid_strategy", o.bid_strategy);
  put("bid_amount", o.bid_amount);
  put("promoted_object", o.promoted_object);
  put("targeting", o.targeting);
  put("destination_type", o.destination_type);
  put("is_dynamic_creative", o.is_dynamic_creative);
  put("pacing_type", o.pacing_type);
  put("dsa_beneficiary", o.dsa_beneficiary);
  put("dsa_payor", o.dsa_payor);
  const cents = budgetCents != null && budgetCents > 0 ? Math.round(budgetCents) : o.daily_budget ? Number(o.daily_budget) : null;
  if (cents) params.daily_budget = String(cents);
  const res = await metaPost<{ id?: string }>(token, `/act_${o.account_id}/adsets`, params);
  if (!res.id) throw new Error("A Meta respondeu sem o id do conjunto novo.");
  return res.id;
}

// Etapa 159c: a cópia nativa de ANÚNCIO também falha às vezes ("O recurso de inclusão do campo de aprimoramentos padrão no criativo foi
// descontinuado…") porque reenvia o criativo com um campo que a Meta aposentou. Alternativa: criar o anúncio novo APONTANDO pro mesmo
// criativo do original (creative_id) — o criativo não é reenviado, então esse campo nem entra. É o que o Gerenciador faz ao duplicar.
async function createAdFromOriginal(token: string, adId: string, newAdsetId: string): Promise<string> {
  const o = await metaGet<{ account_id?: string; name?: string; creative?: { id?: string }; tracking_specs?: unknown }>(token, `/${adId}`, {
    fields: "account_id,name,creative{id},tracking_specs",
  });
  if (!o.account_id || !o.creative?.id) throw new Error("A Meta não devolveu a conta ou o criativo do anúncio original.");
  const params: Record<string, string> = {
    name: o.name ?? adId,
    adset_id: newAdsetId,
    creative: JSON.stringify({ creative_id: o.creative.id }),
    status: "ACTIVE", // fica ativo dentro do conjunto pausado: ativar o conjunto já liga tudo
  };
  if (o.tracking_specs) params.tracking_specs = typeof o.tracking_specs === "string" ? o.tracking_specs : JSON.stringify(o.tracking_specs);
  const res = await metaPost<{ id?: string }>(token, `/act_${o.account_id}/ads`, params);
  if (!res.id) throw new Error("A Meta respondeu sem o id do anúncio novo.");
  return res.id;
}

export interface DuplicateResult {
  ok: boolean;
  newAdsetId?: string;
  newName?: string;
  copiedAds: Array<{ sourceId: string; newId: string | null }>;
  failedAds: Array<{ id: string; name: string; error: string }>;
  warnings: string[]; // problemas de verdade (algo não ficou como pedido)
  notes: string[]; // só informação sobre o método usado
  error?: string; // falha na cópia do conjunto (nada foi criado)
  // Etapa 231: conferência lendo o conjunto novo de volta (WhatsApp igual ao do modelo, idade, início, campanha).
  check?: {
    whatsapp: string | null;
    modelWhatsapp: string | null;
    ageMin: number | null;
    ageMax: number | null;
    startTime: string | null;
    campaignStatus: string | null;
  };
}

interface CopyResponse {
  copied_adset_id?: string;
  copied_ad_id?: string;
  ad_object_ids?: Array<{ ad_object_type?: string; source_id?: string; copied_id?: string }>;
}

export async function duplicateAdSet(
  token: string,
  p: {
    adsetId: string;
    adIds: Array<{ id: string; name: string }>;
    newName: string;
    dailyBudgetCents?: number | null;
    ageMin?: number | null; // Etapa 231
    ageMax?: number | null;
    startTime?: string | null; // ISO com fuso; null = mantém o da cópia
  },
): Promise<DuplicateResult> {
  const out: DuplicateResult = { ok: false, copiedAds: [], failedAds: [], warnings: [], notes: [] };

  // 1) o conjunto — cópia nativa; se a Meta recusar por causa da janela de atribuição, cria a partir do original.
  let newId: string | null = null;
  let createdDirect = false;
  try {
    const info = await metaGet<AdsetFields>(token, `/${p.adsetId}`, { fields: "campaign_id" });
    const params: Record<string, string> = { deep_copy: "false", status_option: "PAUSED", rename_options: NO_RENAME };
    if (info.campaign_id) params.campaign_id = info.campaign_id;
    const res = await metaPost<CopyResponse>(token, `/${p.adsetId}/copies`, params);
    newId = res.copied_adset_id ?? res.ad_object_ids?.find((o) => o.ad_object_type === "ad_set")?.copied_id ?? res.ad_object_ids?.[0]?.copied_id ?? null;
  } catch (e) {
    const msg = (e as Error).message;
    if (ATTRIBUTION_ERR.test(msg)) {
      try {
        newId = await createAdsetFromOriginal(token, p.adsetId, p.newName, p.dailyBudgetCents);
        createdDirect = true;
        out.notes.push("Conjunto criado a partir do original, com atribuição de 1 dia de clique (a cópia nativa da Meta recusa a janela de atribuição).");
      } catch (e2) {
        out.error = `Não consegui copiar o conjunto: ${msg} — e o método alternativo também falhou: ${(e2 as Error).message}`;
        return out;
      }
    } else {
      out.error = `Não consegui copiar o conjunto: ${msg}`;
      return out;
    }
  }
  if (!newId) {
    out.error = "A Meta respondeu sem o id do conjunto novo. Confira no Gerenciador se a cópia foi criada.";
    return out;
  }
  out.newAdsetId = newId;

  // 2) nome e orçamento (o método alternativo já cria com os dois)
  if (createdDirect) {
    out.newName = p.newName;
  } else try {
    const patch: Record<string, string> = { name: p.newName };
    if (p.dailyBudgetCents != null && p.dailyBudgetCents > 0) patch.daily_budget = String(Math.round(p.dailyBudgetCents));
    await metaPost(token, `/${newId}`, patch);
    out.newName = p.newName;
  } catch (e) {
    out.warnings.push(`Conjunto criado, mas não consegui acertar nome/orçamento: ${(e as Error).message}`);
  }

  // 2b) Etapa 231: idade e início (o conjunto é novo, então o início ainda pode ser mudado).
  if ((p.ageMin != null && p.ageMax != null) || p.startTime) {
    try {
      const patch: Record<string, string> = {};
      if (p.ageMin != null && p.ageMax != null) {
        const cur = await metaGet<{ targeting?: Record<string, unknown> }>(token, `/${newId}`, { fields: "targeting" });
        if (cur.targeting && (cur.targeting.age_min !== p.ageMin || cur.targeting.age_max !== p.ageMax)) {
          patch.targeting = JSON.stringify({ ...cur.targeting, age_min: p.ageMin, age_max: p.ageMax });
        }
      }
      if (p.startTime) patch.start_time = p.startTime;
      if (Object.keys(patch).length) await metaPost(token, `/${newId}`, patch);
    } catch (e) {
      out.warnings.push(`Conjunto criado, mas não consegui acertar idade/início: ${(e as Error).message}`);
    }
  }

  // 3) os criativos escolhidos
  let usedAdFallback = false;
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
      // Cópia nativa recusada: cria o anúncio apontando pro mesmo criativo do original.
      try {
        const created = await createAdFromOriginal(token, ad.id, newId);
        out.copiedAds.push({ sourceId: ad.id, newId: created });
        usedAdFallback = true;
      } catch (e2) {
        out.failedAds.push({ id: ad.id, name: ad.name, error: `${(e as Error).message} — e o método alternativo também falhou: ${(e2 as Error).message}` });
      }
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

  // 5) Etapa 231: lê o conjunto novo de volta e confere o WhatsApp com o do modelo (o número trava depois de criado).
  try {
    const [n, m] = await Promise.all([
      metaGet<{ promoted_object?: { whatsapp_phone_number?: string }; targeting?: { age_min?: number; age_max?: number }; start_time?: string; campaign?: { effective_status?: string } }>(
        token,
        `/${newId}`,
        { fields: "promoted_object,targeting{age_min,age_max},start_time,campaign{effective_status}" },
      ),
      metaGet<{ promoted_object?: { whatsapp_phone_number?: string } }>(token, `/${p.adsetId}`, { fields: "promoted_object" }),
    ]);
    out.check = {
      whatsapp: n.promoted_object?.whatsapp_phone_number ?? null,
      modelWhatsapp: m.promoted_object?.whatsapp_phone_number ?? null,
      ageMin: n.targeting?.age_min ?? null,
      ageMax: n.targeting?.age_max ?? null,
      startTime: n.start_time ?? null,
      campaignStatus: (n.campaign?.effective_status ?? "").toUpperCase() || null,
    };
    if (out.check.whatsapp !== out.check.modelWhatsapp) {
      out.warnings.push(
        `O WhatsApp do conjunto novo (${out.check.whatsapp ?? "não informado — vai usar o padrão da página"}) é diferente do modelo (${out.check.modelWhatsapp ?? "não informado"}). Não ative sem conferir.`,
      );
    }
  } catch (e) {
    out.warnings.push(`Não consegui ler o conjunto novo de volta pra conferir o WhatsApp: ${(e as Error).message}`);
  }

  if (usedAdFallback) out.notes.push("Anúncios criados reaproveitando o criativo do original (a cópia nativa da Meta recusa esse criativo).");
  out.ok = true;
  return out;
}
