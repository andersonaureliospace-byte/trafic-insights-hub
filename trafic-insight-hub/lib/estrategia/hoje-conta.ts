import { metaGetAll } from "@/lib/meta/client";
import { EXCLUDED_OBJECTIVES, isJobCampaign, isNonLeadResultType, isVaga, leadResultOf } from "@/lib/meta/shared";
import { normAccountId } from "@/lib/meta/daily-store";

// Etapa 341: gasto e resultados de HOJE (ou de um dia) de uma conta — 1 pedido à Meta. Saiu de /api/estrategia/hoje pra
// automação das tarefas de Alerta (estr-tick) usar a mesma conta.
type Row = {
  campaign_name?: string;
  objective?: string;
  spend?: string;
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type?: string; value?: string }>;
};

// dia = undefined → hoje; "YYYY-MM-DD" → aquele dia (usado só quando o backup ainda não tem ontem)
export async function hojeDaConta(token: string, id: string, dia?: string): Promise<{ spend: number; results: number }> {
  const rows = await metaGetAll<Row>(token, `/act_${normAccountId(id)}/insights`, {
    fields: "campaign_name,objective,spend,results,actions",
    ...(dia ? { time_range: JSON.stringify({ since: dia, until: dia }) } : { date_preset: "today" }),
    // por conjunto: em CBO com otimizações diferentes o resultado da campanha vem misturado (Etapa 304)
    level: "adset",
    limit: "500",
    use_unified_attribution_setting: "true",
  });
  let spend = 0;
  let results = 0;
  for (const r of rows) {
    if (isJobCampaign(r.campaign_name)) continue;
    spend += r.spend ? Number(r.spend) : 0;
    if (isVaga(r.campaign_name)) continue;
    if (r.objective && EXCLUDED_OBJECTIVES.has(r.objective)) continue;
    const lr = leadResultOf(r.results, r.actions);
    if (isNonLeadResultType(lr.type)) continue;
    if (lr.value != null) results += lr.value;
  }
  return { spend, results };
}

