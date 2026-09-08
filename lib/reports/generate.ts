// Monta o texto do relatório periódico a partir de um modelo (com
// variáveis tipo {cliente}) e das métricas reais da conta no período
// escolhido. Um relatório agendado pode cobrir mais de uma conta — nesse
// caso o modelo é aplicado uma vez por conta e os blocos são concatenados
// (útil pra franquias/redes que mandam um resumo de várias unidades pro
// mesmo grupo).

import type { DatePreset } from "@/lib/meta/client";
import { getAccountInsight } from "@/lib/meta/insights";
import { fmtCurrency, DATE_PRESETS } from "@/lib/format";

export function periodLabel(preset: string): string {
  return DATE_PRESETS.find((p) => p.id === preset)?.label ?? preset;
}

interface AccountContext {
  ad_account_id: string;
  client_name: string;
  cpa_target: number | null;
  monthly_investment: number | null;
}

function interpolateReport(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

export async function buildReportMessage(
  token: string,
  templateBody: string,
  periodPreset: DatePreset,
  accounts: AccountContext[],
): Promise<string> {
  const blocks: string[] = [];
  for (const acc of accounts) {
    let block: string;
    try {
      const insight = await getAccountInsight(token, acc.ad_account_id, periodPreset);
      block = interpolateReport(templateBody, {
        cliente: acc.client_name,
        periodo: periodLabel(periodPreset),
        investido: fmtCurrency(insight.spend),
        resultados: insight.results ? String(Math.round(insight.results)) : "—",
        cpa: fmtCurrency(insight.cost_per_result),
        meta_cpa: fmtCurrency(acc.cpa_target),
        invest_mensal: fmtCurrency(acc.monthly_investment),
      });
    } catch (e) {
      block = `${acc.client_name}: não foi possível carregar os dados agora (${(e as Error).message}).`;
    }
    blocks.push(block);
  }
  return blocks.join("\n\n");
}
