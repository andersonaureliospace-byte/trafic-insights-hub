import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll } from "@/lib/meta/client";
import { EXCLUDED_OBJECTIVES, isJobCampaign, isNonLeadResultType, isVaga, leadResultOf } from "@/lib/meta/shared";
import { readStoredDaysMany, normAccountId } from "@/lib/meta/daily-store";
import { addDaysYmd, todayBrt } from "@/lib/meta/daily-range";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";

// Etapa 309: botão "Atualizar" do Acompanhamento = só as métricas de HOJE.
//   - dias fechados: do backup no Supabase (nenhum pedido à Meta)
//   - hoje: 1 pedido à Meta por conta (insights de hoje por conjunto, já com o objetivo da campanha — sem buscar a lista de campanhas)
// Antes o Atualizar fazia ~11 pedidos por conta (lista de campanhas, dias que faltavam, orçamento, alertas, nomenclatura).
export const maxDuration = 60;

type Row = {
  campaign_name?: string;
  objective?: string;
  spend?: string;
  results?: Array<{ indicator?: string; values?: Array<{ value?: string }> }>;
  actions?: Array<{ action_type?: string; value?: string }>;
};

async function hojeDaConta(token: string, id: string): Promise<{ spend: number; results: number }> {
  const rows = await metaGetAll<Row>(token, `/act_${normAccountId(id)}/insights`, {
    fields: "campaign_name,objective,spend,results,actions",
    date_preset: "today",
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

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown; days?: unknown };
    const ids = (Array.isArray(body.accountIds) ? body.accountIds : []).map((x) => normAccountId(String(x))).filter(Boolean).slice(0, 15);
    const days = Math.max(1, Math.min(62, Number(body.days) || 1));
    const today = todayBrt();
    const since = addDaysYmd(today, -(days - 1));
    const yesterday = addDaysYmd(today, -1);

    const stored = since <= yesterday ? await readStoredDaysMany(ids, since, yesterday) : new Map();
    const hoje = new Map<string, { spend: number; results: number }>();
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          hoje.set(id, await hojeDaConta(token, id));
        } catch (e) {
          failed.push(id);
          console.error("hoje err", id, (e as Error).message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));

    const daily: Record<string, DailyCpaPoint[]> = {};
    for (const id of ids) {
      const guardados = stored.get(id);
      const pts: DailyCpaPoint[] = [];
      for (let d = since; d <= yesterday; d = addDaysYmd(d, 1)) {
        const v = guardados?.get(d);
        pts.push({ date: d, spend: v?.spend ?? 0, results: v?.results ?? 0, cpa: v && v.results > 0 && v.spend > 0 ? v.spend / v.results : null });
      }
      const h = hoje.get(id) ?? { spend: 0, results: 0 };
      pts.push({ date: today, spend: h.spend, results: h.results, cpa: h.results > 0 && h.spend > 0 ? h.spend / h.results : null });
      daily[id] = pts;
    }
    return NextResponse.json({ daily, failed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
