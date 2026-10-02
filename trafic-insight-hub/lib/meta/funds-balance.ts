// Etapa 81: "Saldo por fundos" — ver supabase/migrations/0025_*.
//
// A Meta não expõe um campo pronto pro "Fundos disponíveis" que aparece no
// Ads Manager (confirmado testando a Graph API direto, inclusive a edge
// `balance` e `funding_source_details`, que só trazem o valor acumulado a
// pagar e o método de pagamento, nunca esse número). O jeito encontrado foi
// reconstruir a partir do histórico de atividades da conta (`/activities`),
// que tem dois eventos relevantes:
//   - funding_event_successful ("Quantia adicionada ao saldo"): dinheiro
//     entrando (PIX avulso, cartão etc.) — soma.
//   - ad_account_billing_charge ("Conta cobrada"): dinheiro saindo (cobrança
//     da Meta pelo gasto em anúncios) — subtrai.
// A Meta só guarda ~90 dias desse histórico (testado e confirmado), então
// não dá — nem faz sentido — tentar reconstruir "desde sempre" numa conta
// mais velha que isso. Por decisão do usuário: o valor começa de um saldo
// inicial informado manualmente (ele já sabe esse número olhando o Ads
// Manager) e, a partir do momento que é definido, só soma/subtrai o que
// aparecer dali em diante — nunca reprocessa transação antiga. Não existe
// filtro de categoria pra isso na API (testado — só aceita category em
// {ACCOUNT, AD, AD_KEYWORDS, AD_SET, AUDIENCE, BID, BUDGET, CAMPAIGN, DATE,
// STATUS, TARGETING}), então tem que paginar e filtrar aqui pelo
// event_type — mas como é sempre a partir de um watermark recente, isso é
// rápido (normalmente cabe numa página só).
//
// Guarda o event_time do último evento somado (funds_balance_watermark)
// pra, da próxima vez, buscar só o que é mais novo que isso. Esse
// watermark é resetado pra "agora" toda vez que o usuário define/corrige o
// saldo inicial manualmente (ver PersonalizarAlertasPanel), pra nunca
// contar de novo uma transação de antes da correção.

import { metaGet } from "./client";

// Fallback defensivo (não deveria ser usado na prática — a UI sempre
// define um watermark ao ligar o recurso); ~90 dias é o máximo que a Meta
// guarda mesmo, então ir mais pra trás que isso não traria nada a mais.
const FALLBACK_SINCE_DAYS = 90;

interface Activity {
  event_type: string;
  event_time: string;
  extra_data?: string;
}

interface ActivitiesPage {
  data: Activity[];
  paging?: { next?: string };
}

function parseAmountCents(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // funding_event_successful usa "amount"; ad_account_billing_charge usa
    // "new_value" (ambos em centavos, mesma unidade do resto do app).
    const value = parsed.amount ?? parsed.new_value;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export interface FundsBalanceResult {
  deltaCents: number;
  currency: string | null;
  newWatermark: string | null; // event_time do evento mais recente processado
  eventsProcessed: number;
}

// Busca e soma só os eventos novos desde `sinceWatermark` (ou o histórico
// inteiro, se nunca calculado). Limita a `maxPages` por chamada (cada
// página = até 500 eventos) pra não estourar o tempo de uma função
// serverless numa conta muito antiga/movimentada — o que sobrar fica pra
// próxima rodada da tick (o watermark avança só até onde deu de processar).
export async function refreshFundsBalance(
  token: string,
  accountId: string,
  sinceWatermark: string | null,
  maxPages = 20,
): Promise<FundsBalanceResult> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  // "since" da Graph API é por dia (YYYY-MM-DD), não por segundo — por
  // segurança busca 1 dia antes do watermark e descarta de novo qualquer
  // evento <= watermark exato, pra nunca pular nem duplicar um evento que
  // caia bem na borda do dia.
  const sinceDate = sinceWatermark
    ? sinceWatermark.slice(0, 10)
    : new Date(Date.now() - FALLBACK_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let deltaCents = 0;
  let currency: string | null = null;
  let newWatermark = sinceWatermark;
  let eventsProcessed = 0;
  let pages = 0;
  let url: string | null = null;

  // Sem "until": a Graph API usa "agora" como fim do período por padrão.
  let page = await metaGet<ActivitiesPage>(token, `/${id}/activities`, {
    fields: "event_type,event_time,extra_data",
    since: sinceDate,
    limit: "500",
  });
  for (;;) {
    for (const ev of page.data) {
      if (sinceWatermark && ev.event_time <= sinceWatermark) continue; // já processado
      if (ev.event_type !== "funding_event_successful" && ev.event_type !== "ad_account_billing_charge") continue;
      const amount = parseAmountCents(ev.extra_data);
      if (amount == null) continue;
      try {
        const parsed = JSON.parse(ev.extra_data ?? "{}") as Record<string, unknown>;
        if (typeof parsed.currency === "string") currency = parsed.currency;
      } catch {
        /* ignore */
      }
      deltaCents += ev.event_type === "funding_event_successful" ? amount : -amount;
      eventsProcessed++;
      if (!newWatermark || ev.event_time > newWatermark) newWatermark = ev.event_time;
    }
    pages++;
    url = page.paging?.next ?? null;
    if (!url || pages >= maxPages) break;
    const res = await fetch(url);
    if (!res.ok) break;
    page = (await res.json()) as ActivitiesPage;
  }

  return { deltaCents, currency, newWatermark, eventsProcessed };
}
