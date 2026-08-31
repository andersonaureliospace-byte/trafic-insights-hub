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
