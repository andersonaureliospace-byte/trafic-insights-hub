import { metaPost } from "./client";

export type MetaObjectType = "campaign" | "adset" | "ad";

const CREATIVE_UNAVAILABLE_PATTERNS = [
  /reel/i,
  /n[aã]o est[aá] dispon/i,
  /not available/i,
  /creative/i,
  /post.*(deleted|exclu[ií])/i,
  /m[ií]dia.*(indispon|exclu)/i,
];

function friendlyError(type: MetaObjectType, msg: string): string {
  if (type === "ad" && CREATIVE_UNAVAILABLE_PATTERNS.some((re) => re.test(msg))) {
    return "O criativo desse anúncio não está mais disponível (post apagado ou mídia removida) — o Meta não deixa pausar/ativar nesse estado.";
  }
  return msg;
}

export async function setEntitiesStatus(
  token: string,
  items: { id: string; type: MetaObjectType }[],
  status: "ACTIVE" | "PAUSED",
): Promise<{ id: string; ok: boolean; error?: string }[]> {
  return Promise.all(
    items.map(async (it) => {
      try {
        await metaPost<{ success?: boolean }>(token, `/${it.id}`, { status });
        return { id: it.id, ok: true };
      } catch (e) {
        return { id: it.id, ok: false, error: friendlyError(it.type, (e as Error).message) };
      }
    }),
  );
}

// Etapa 56: variante sequencial (uma requisição de cada vez, com pausa entre
// elas) — mesma ideia/tempo (3s) já usado pelos botões manuais de ação em
// massa de Painel > Análise (BULK_DELAY_MS, em analise-tab.tsx), só que
// pro lado das automações que já rodam em segundo plano (n8n). Usada pelas
// pausas automáticas de Conjuntos e Criativos (lib/alerts/adsets-pause.ts,
// lib/alerts/creatives-pause.ts), que costumam pausar várias entidades de
// uma vez e antes mandavam tudo em paralelo (Promise.all) — risco
// desnecessário de rate limit da Meta com listas grandes. `setEntitiesStatus`
// (acima) continua igual e em paralelo pros outros usos (botão manual de
// pausar/ativar 1 item por vez em app/api/meta/status/route.ts, e a
// Verificação de Localização/Erros de lib/audit/run.ts, que já pausa lotes
// bem menores, por conta).
const DEFAULT_SEQUENTIAL_DELAY_MS = 3000;

export async function setEntitiesStatusSequential(
  token: string,
  items: { id: string; type: MetaObjectType }[],
  status: "ACTIVE" | "PAUSED",
  delayMs: number = DEFAULT_SEQUENTIAL_DELAY_MS,
): Promise<{ id: string; ok: boolean; error?: string }[]> {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      await metaPost<{ success?: boolean }>(token, `/${it.id}`, { status });
      results.push({ id: it.id, ok: true });
    } catch (e) {
      results.push({ id: it.id, ok: false, error: friendlyError(it.type, (e as Error).message) });
    }
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}
