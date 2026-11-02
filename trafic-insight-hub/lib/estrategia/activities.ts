// Etapa 238 (Hub estratégico): "Otimizações recentes" — o histórico de atividades da conta na Meta (/activities):
// quem mudou o quê e quando (orçamento, liga/desliga, criativo novo, público...). Os eventos de cobrança/saldo ficam de fora.
// Guardado 5 min na memória do servidor (a tela pede junto pra todas as contas).

import { metaGet, spDate } from "@/lib/meta/client";
import { memoMeta, tokenTag } from "@/lib/meta/memo";

export interface ActivityItem {
  time: string; // ISO
  actor: string | null;
  what: string; // evento traduzido pela Meta ("Orçamento do conjunto de anúncios atualizado"…)
  object: string | null; // nome da campanha/conjunto/anúncio
  type: string; // event_type bruto
  relevant: boolean; // Etapa 242: otimização relevante (ver RELEVANT abaixo)
}

// Etapa 242: o que conta como OTIMIZAÇÃO RELEVANTE do gestor — mexe no resultado da conta:
//   orçamento/limite, liga/desliga (campanha, conjunto, anúncio), criou campanha/conjunto/anúncio,
//   público/segmentação, criativo, lance/meta de otimização.
// NÃO conta: trocar nome, cobrança/saldo/pagamento, mudanças de conta.
const RELEVANT: RegExp[] = [/budget|spend_cap/, /run_status/, /^create_(ad|ad_set|adgroup|campaign)/, /target/, /creative/, /bid|optimization_goal/];
const NOT_RELEVANT = /name|friendly/;
export function isRelevantActivity(type: string): boolean {
  if (NOT_RELEVANT.test(type)) return false;
  return RELEVANT.some((re) => re.test(type));
}

interface ActivityRow {
  event_type?: string;
  translated_event_type?: string;
  event_time?: string;
  actor_name?: string;
  object_name?: string;
}

const SKIP = /billing|funding|payment|spend_limit|account_spending_limit|charge|receipt|invoice/i;
const CONCURRENCY = 4;
export const ACTIVITY_DAYS = 7;

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function accountActivities(token: string, accountId: string): Promise<ActivityItem[]> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  return memoMeta(
    `estr-activities2:${act}:${tokenTag(token)}`,
    5 * 60_000,
    async () => {
      const since = addDaysYmd(spDate(new Date()), -ACTIVITY_DAYS);
      const page = await metaGet<{ data?: ActivityRow[] }>(token, `/${act}/activities`, {
        fields: "event_type,translated_event_type,event_time,actor_name,object_name",
        since,
        limit: "300",
      });
      return (page.data ?? [])
        .filter((r) => r.event_type && r.event_time && !SKIP.test(r.event_type))
        .map((r) => ({
          time: new Date(r.event_time as string).toISOString(),
          actor: r.actor_name ?? null,
          what: r.translated_event_type || (r.event_type as string),
          object: r.object_name ?? null,
          type: r.event_type as string,
          relevant: isRelevantActivity(r.event_type as string),
        }))
        .sort((a, b) => b.time.localeCompare(a.time));
    },
    { staleOnError: true },
  );
}

// Por conta: as atividades dos últimos 7 dias (mais recente primeiro). Conta que falhou volta em `failed`.
export async function activitiesForAccounts(
  token: string,
  accountIds: string[],
): Promise<{ byAccount: Record<string, ActivityItem[]>; failed: string[] }> {
  const byAccount: Record<string, ActivityItem[]> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < accountIds.length) {
      const id = accountIds[next++];
      try {
        byAccount[id] = await accountActivities(token, id);
      } catch (e) {
        console.error("estrategia activities err", id, (e as Error).message?.slice(0, 160));
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accountIds.length) }, worker));
  return { byAccount, failed };
}
