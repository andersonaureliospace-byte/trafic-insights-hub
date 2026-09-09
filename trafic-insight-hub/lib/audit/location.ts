// Auditoria de Localização — portado do app anterior (audit-location.server.ts).
// Marca como incorreto qualquer conjunto ativo (com campanha ativa e ao menos
// um anúncio ativo) segmentando o Brasil inteiro (sem restrição de
// estado/cidade) ou com a expansão de público ligada.

import { metaGetAll } from "@/lib/meta/client";

export interface AuditLocationIssue {
  adset_id: string;
  adset_name: string;
  campaign_name: string | null;
  reasons: string[];
}

export const REASON_BRASIL = "Localização: Brasil (país inteiro)";
export const REASON_ADVANTAGE = "Público Advantage+ ativado";
export const REASON_EXPANSION =
  'Expansão de público ("Alcançar mais pessoas com probabilidade de responder aos seus anúncios")';

interface Targeting {
  geo_locations?: {
    countries?: string[];
    regions?: unknown[];
    cities?: unknown[];
    zips?: unknown[];
    custom_locations?: unknown[];
    geo_markets?: unknown[];
    places?: unknown[];
  };
  targeting_automation?: { advantage_audience?: number };
  targeting_optimization?: string;
  targeting_relaxation_types?: Record<string, number>;
}

export function evaluateTargetingDetailed(t: Targeting | undefined | null): {
  blocking: string[];
  info: string[];
} {
  const reasons: string[] = [];
  const info: string[] = [];
  const geo = t?.geo_locations ?? {};
  const hasCountryBR = (geo.countries ?? []).some((c) => String(c).toUpperCase() === "BR");
  const hasNarrower =
    (geo.regions?.length ?? 0) > 0 ||
    (geo.cities?.length ?? 0) > 0 ||
    (geo.zips?.length ?? 0) > 0 ||
    (geo.custom_locations?.length ?? 0) > 0 ||
    (geo.geo_markets?.length ?? 0) > 0 ||
    (geo.places?.length ?? 0) > 0;
  if (hasCountryBR && !hasNarrower) reasons.push(REASON_BRASIL);

  const advantage = Number(t?.targeting_automation?.advantage_audience ?? 0) === 1;
  if (advantage) info.push(REASON_ADVANTAGE);

  const relaxation = Object.values(t?.targeting_relaxation_types ?? {}).some((v) => Number(v) === 1);
  const optimization = ["expansion_all", "targeting_relaxation"].includes(
    String(t?.targeting_optimization ?? ""),
  );
  if (relaxation || optimization) reasons.push(REASON_EXPANSION);

  return { blocking: reasons, info };
}

interface AdsetLocationRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  end_time?: string;
  targeting?: Targeting;
  campaign?: { name?: string; effective_status?: string };
  ads?: { data?: Array<{ id: string }> };
}

export async function auditAccountLocation(
  token: string,
  adAccountId: string,
): Promise<{ issues: AuditLocationIssue[]; checked: number }> {
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const rows = await metaGetAll<AdsetLocationRow>(
    token,
    `/${actId}/adsets`,
    {
      fields:
        "id,name,status,effective_status,end_time,targeting,campaign{name,effective_status},ads.effective_status(['ACTIVE']).limit(1){id}",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: "200",
    },
    5,
  );

  const issues: AuditLocationIssue[] = [];
  let checked = 0;
  const now = Date.now();

  for (const row of rows) {
    if (String(row.status ?? "").toUpperCase() !== "ACTIVE") continue;
    if (String(row.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if (String(row.campaign?.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if ((row.ads?.data?.length ?? 0) === 0) continue;
    if (row.end_time && new Date(row.end_time).getTime() <= now) continue;

    checked++;
    const { blocking, info } = evaluateTargetingDetailed(row.targeting);
    if (blocking.length > 0) {
      issues.push({
        adset_id: row.id,
        adset_name: row.name || row.id,
        campaign_name: row.campaign?.name ?? null,
        reasons: [...blocking, ...info],
      });
    }
  }

  return { issues, checked };
}
