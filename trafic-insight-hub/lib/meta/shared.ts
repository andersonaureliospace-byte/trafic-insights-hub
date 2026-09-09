// Helpers compartilhados entre insights.ts e breakdown.ts.

export const isVaga = (name?: string) => !!name && /(vaga|seguidores)/i.test(name);

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
