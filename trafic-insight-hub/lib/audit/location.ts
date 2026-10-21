// Auditoria de Localização — portado do app anterior (audit-location.server.ts).
// Marca como incorreto qualquer conjunto ativo (com campanha ativa e ao menos
// um anúncio ativo) segmentando o Brasil inteiro (sem restrição de
// estado/cidade) ou com a expansão de público ligada.
// Etapa 180: Brasil inteiro continua sendo PAUSADO; a expansão de público ("Alcançar mais pessoas com probabilidade de
// responder aos seus anúncios") NUNCA pausa — só DESLIGA a caixa (disableLocationExpansion) e o conjunto segue ativo.

import { metaGet, metaGetAll, metaPost } from "@/lib/meta/client";

export interface AuditLocationIssue {
  adset_id: string;
  adset_name: string;
  campaign_name: string | null;
  reasons: string[];
  pause: boolean; // tem problema que pausa (Brasil inteiro)
  expansion: boolean; // expansão de público ligada (só desliga a caixa, nunca pausa)
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
    // Checkbox "Alcançar mais pessoas com probabilidade de responder aos seus anúncios" (Público > Localizações): expand_locations 1 = ligado.
    location_expansion?: { expand_locations?: number | boolean };
  };
  targeting_automation?: { advantage_audience?: number; individual_setting?: { geo?: number } };
  targeting_optimization?: string;
  targeting_relaxation_types?: Record<string, number>;
}

export function evaluateTargetingDetailed(t: Targeting | undefined | null): {
  blocking: string[]; // motivos que PAUSAM (Brasil inteiro)
  expansion: boolean; // expansão ligada: só desliga a caixa
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
  // Etapa 179: o checkbox de expansão de localização vive em geo_locations.location_expansion (não em targeting_relaxation_types).
  const locationExpansion = Number(geo.location_expansion?.expand_locations ?? 0) === 1;
  const optimization = ["expansion_all", "targeting_relaxation"].includes(
    String(t?.targeting_optimization ?? ""),
  );
  // Etapa 181 (confirmado num conjunto de teste da IVS Ijuí): com a caixa LIGADA a Meta devolve targeting_automation.individual_setting.geo = 1
  // (desligada: geo = 0 ou sem a chave). A chave geo_locations.location_expansion não aparece nessa situação, mas fica na checagem por garantia.
  const geoExpansion = Number(t?.targeting_automation?.individual_setting?.geo ?? 0) === 1;
  const expansion = relaxation || optimization || locationExpansion || geoExpansion;

  return { blocking: reasons, expansion, info };
}

// Targeting com a expansão desligada. A Meta SUBSTITUI o targeting inteiro na gravação (não mescla), então manda tudo que veio,
// menos o que a Meta só devolve como leitura: effective_*, age_range e page_types (a Meta recusa: "Page types have been replaced
// with Ad placements" — testado no conjunto de teste de Ijuí). A caixa é targeting_automation.individual_setting.geo (1 = ligada).
export function buildTargetingWithoutExpansion(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (k.startsWith("effective_") || k === "age_range" || k === "page_types") continue;
    out[k] = v;
  }
  const auto = { ...((out.targeting_automation as Record<string, unknown> | undefined) ?? {}) };
  auto.individual_setting = { ...((auto.individual_setting as Record<string, unknown> | undefined) ?? {}), geo: 0 };
  out.targeting_automation = auto;
  const geo = { ...((out.geo_locations as Record<string, unknown> | undefined) ?? {}) };
  if (geo.location_expansion) {
    geo.location_expansion = { expand_locations: 0 };
    out.geo_locations = geo;
  }
  const relax = out.targeting_relaxation_types as Record<string, number> | undefined;
  if (relax) out.targeting_relaxation_types = Object.fromEntries(Object.keys(relax).map((k) => [k, 0]));
  if (["expansion_all", "targeting_relaxation"].includes(String(out.targeting_optimization ?? ""))) out.targeting_optimization = "none";
  return out;
}

// Desliga a caixa de expansão de UM conjunto. NUNCA deixa o conjunto pausado por causa disso: se depois da edição o conjunto
// deixou de estar ativo (a Meta às vezes muda o status ao editar), reativa na hora.
export async function disableLocationExpansion(
  token: string,
  adsetId: string,
): Promise<{ ok: boolean; reactivated?: boolean; error?: string }> {
  try {
    const cur = await metaGet<{ targeting?: Record<string, unknown>; status?: string }>(token, `/${adsetId}`, { fields: "targeting,status" });
    if (!cur.targeting) return { ok: false, error: "A Meta não devolveu o público do conjunto." };
    const wasActive = String(cur.status ?? "").toUpperCase() === "ACTIVE";
    await metaPost(token, `/${adsetId}`, { targeting: JSON.stringify(buildTargetingWithoutExpansion(cur.targeting)) });
    let reactivated = false;
    if (wasActive) {
      const after = await metaGet<{ status?: string }>(token, `/${adsetId}`, { fields: "status" });
      if (String(after.status ?? "").toUpperCase() !== "ACTIVE") {
        await metaPost(token, `/${adsetId}`, { status: "ACTIVE" });
        reactivated = true;
      }
    }
    return { ok: true, reactivated };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 220) };
  }
}

interface AdsetLocationRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  end_time?: string;
  updated_time?: string;
  targeting?: Targeting;
  campaign?: { name?: string; effective_status?: string };
  ads?: { data?: Array<{ id: string }> };
}

// Etapa 182: `sinceMs` liga o modo "recentes" — só conjuntos criados/alterados desde esse instante (updated_time),
// uma chamada leve por conta; usado pelo n8n a cada poucos minutos. Sem `sinceMs` = varredura completa (como antes).
export async function auditAccountLocation(
  token: string,
  adAccountId: string,
  opts?: { sinceMs?: number },
): Promise<{ issues: AuditLocationIssue[]; checked: number; checkedIds: string[] }> {
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const baseParams: Record<string, string> = {
    fields:
      "id,name,status,effective_status,end_time,updated_time,targeting,campaign{name,effective_status},ads.effective_status(['ACTIVE']).limit(1){id}",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "200",
  };
  const sinceMs = opts?.sinceMs;
  let rows: AdsetLocationRow[];
  if (sinceMs) {
    try {
      rows = await metaGetAll<AdsetLocationRow>(
        token,
        `/${actId}/adsets`,
        { ...baseParams, filtering: JSON.stringify([{ field: "updated_time", operator: "GREATER_THAN", value: Math.floor(sinceMs / 1000) }]) },
        5,
      );
    } catch {
      // Se a Meta recusar o filtro, cai na varredura completa (o corte por updated_time abaixo garante o mesmo resultado).
      rows = await metaGetAll<AdsetLocationRow>(token, `/${actId}/adsets`, baseParams, 5);
    }
  } else {
    rows = await metaGetAll<AdsetLocationRow>(token, `/${actId}/adsets`, baseParams, 5);
  }

  const issues: AuditLocationIssue[] = [];
  const checkedIds: string[] = [];
  let checked = 0;
  const now = Date.now();

  for (const row of rows) {
    if (sinceMs && row.updated_time && new Date(row.updated_time).getTime() < sinceMs) continue;
    if (String(row.status ?? "").toUpperCase() !== "ACTIVE") continue;
    if (String(row.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if (String(row.campaign?.effective_status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if ((row.ads?.data?.length ?? 0) === 0) continue;
    if (row.end_time && new Date(row.end_time).getTime() <= now) continue;

    checked++;
    checkedIds.push(row.id);
    const { blocking, expansion, info } = evaluateTargetingDetailed(row.targeting);
    if (blocking.length > 0 || expansion) {
      issues.push({
        adset_id: row.id,
        adset_name: row.name || row.id,
        campaign_name: row.campaign?.name ?? null,
        reasons: [...blocking, ...(expansion ? [REASON_EXPANSION] : []), ...info],
        pause: blocking.length > 0,
        expansion,
      });
    }
  }

  return { issues, checked, checkedIds };
}
