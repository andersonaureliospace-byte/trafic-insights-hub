// Helpers compartilhados entre insights.ts e breakdown.ts.

// Nome mantido (isVaga) por já estar espalhado pelo código, mas o critério é
// "campanha excluída por nomenclatura" — cobre "vaga"/"seguidores" (já
// existia) e, desde a Etapa 65, também "[TRÁFEGO]" (com ou sem acento), a
// pedido explícito: campanha com essa tag no nome não deve aparecer em
// nenhuma métrica/tela do Painel, igual [VAGA] já não aparecia.
export const isVaga = (name?: string) => !!name && /(vaga|seguidores|tr[aá]fego)/i.test(name);

// Etapa 84: só "vaga" fica fora do INVESTIMENTO por nome. Seguidores e
// [TRÁFEGO] (que isVaga também pega) contam no investimento — só não entram em
// resultado/CPA (aí continua valendo isVaga, como sempre).
export const isJobCampaign = (name?: string) => !!name && /vaga/i.test(name);

export const EXCLUDED_OBJECTIVES = new Set([
  "OUTCOME_AWARENESS",
  "BRAND_AWARENESS",
  "REACH",
  "OUTCOME_TRAFFIC",
  "LINK_CLICKS",
  "VIDEO_VIEWS",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
]);

// Etapa 184: tipos de "resultado" que NÃO são lead/conversa — interação no post, clique, visualização, alcance, curtida. Campanha de
// Engajamento (OUTCOME_ENGAGEMENT) otimizada pra interação no post devolve milhares disso a centavos (ex.: 2.444 em R$ 113 numa campanha
// arquivada de Guaratinguetá) e derrubava o CPA do mês pra R$ 0,76. Esse resultado nunca entra no CPA; o gasto continua no Investimento.
// OUTCOME_ENGAGEMENT com conversas de WhatsApp (messaging_conversation_started) continua contando normalmente.
export const NON_LEAD_RESULT_TYPES = new Set([
  "post_engagement",
  "page_engagement",
  "link_click",
  "landing_page_view",
  "video_view",
  "thruplay",
  "reach",
  "impressions",
  "like",
  "page_like",
]);

export const isNonLeadResultType = (t?: string | null): boolean => !!t && NON_LEAD_RESULT_TYPES.has(t);

// Tipo do resultado de uma linha de insights ("actions:post_engagement" -> "post_engagement"; "reach" -> "reach").
export function resultTypeOf(results: Array<{ indicator?: string }> | undefined): string | null {
  const ind = results?.[0]?.indicator;
  if (!ind) return null;
  return ind.includes(":") ? ind.split(":").slice(1).join(":") : ind;
}

const MESSAGING_ACTION = "onsite_conversion.messaging_conversation_started_7d";

// Conversas iniciadas (WhatsApp/Messenger/Direct) dentro de `actions` de uma linha de insights.
export function messagingFromActions(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  let sum = 0;
  for (const a of actions ?? []) if (a.action_type === MESSAGING_ACTION) sum += Number(a.value) || 0;
  return sum;
}

// Resultado "de lead" de uma linha de campanha. Caso especial (Guaratinguetá): campanha de Engajamento cujo CONJUNTO otimiza pra conversas
// iniciadas, mas o campo `results` no nível da campanha vem como post_engagement (2.444 em vez das 23 conversas reais no Gerenciador).
// Se o tipo vier como não-lead, usa as conversas iniciadas de `actions` (se houver); sem conversas, continua não-lead e o chamador exclui.
export function leadResultOf(
  results: Array<{ indicator?: string; values?: Array<{ value?: string }> }> | undefined,
  actions: Array<{ action_type?: string; value?: string }> | undefined,
): { value: number | null; type: string | null } {
  const value = pickFirstNumeric(results);
  const type = resultTypeOf(results);
  if (isNonLeadResultType(type)) {
    const m = messagingFromActions(actions);
    if (m > 0) return { value: m, type: MESSAGING_ACTION };
  }
  return { value, type };
}

export function pickFirstNumeric(
  arr: Array<{ values?: Array<{ value?: string }> }> | undefined,
): number | null {
  if (!arr) return null;
  for (const item of arr) {
    let sum = 0;
    let found = false;
    for (const v of item?.values ?? []) {
      const n = Number(v?.value);
      if (Number.isFinite(n) && n > 0) {
        sum += n;
        found = true;
      }
    }
    if (found) return sum;
  }
  return null;
}

export function lifetimeToDailyEquivalent(
  lifetimeCents: string | number | undefined | null,
  startTime?: string | null,
  stopTime?: string | null,
  createdTime?: string | null,
): number {
  if (lifetimeCents == null) return 0;
  const lifetime = Number(lifetimeCents) / 100;
  if (!Number.isFinite(lifetime) || lifetime <= 0) return 0;

  const start = startTime || createdTime;
  if (start && stopTime) {
    const s = new Date(start).getTime();
    const e = new Date(stopTime).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      const totalDays = Math.max(1, Math.round((e - s) / 86_400_000));
      return lifetime / totalDays;
    }
  }
  const now = new Date();
  if (stopTime) {
    const stop = new Date(stopTime).getTime();
    const remaining = Math.ceil((stop - now.getTime()) / 86_400_000);
    return lifetime / Math.max(remaining, 1);
  }
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remaining = daysInMonth - now.getDate() + 1;
  return lifetime / Math.max(remaining, 1);
}

const pageAccessCache = new Map<string, { ok: boolean | null; ts: number }>();
const PAGE_ACCESS_TTL_MS = 10 * 60 * 1000;

export async function checkPageAdsAccess(
  metaGet: <T>(token: string, path: string, params: Record<string, string>) => Promise<T>,
  token: string,
  pageId: string,
): Promise<boolean | null> {
  const cacheKey = `${token.slice(-10)}|${pageId}`;
  const cached = pageAccessCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PAGE_ACCESS_TTL_MS) return cached.ok;
  try {
    const res = await metaGet<{ id?: string; access_token?: string }>(token, `/${pageId}`, {
      fields: "id,access_token",
    });
    const ok = res.access_token ? true : null;
    pageAccessCache.set(cacheKey, { ok, ts: Date.now() });
    return ok;
  } catch {
    pageAccessCache.set(cacheKey, { ok: null, ts: Date.now() });
    return null;
  }
}

export function extractAdPageId(ad: {
  creative?: {
    object_story_spec?: { page_id?: string };
    effective_object_story_id?: string;
  };
}): string | null {
  const spec = ad.creative?.object_story_spec?.page_id;
  if (spec) return spec;
  const eosi = ad.creative?.effective_object_story_id;
  if (eosi && eosi.includes("_")) return eosi.split("_")[0] || null;
  return null;
}
