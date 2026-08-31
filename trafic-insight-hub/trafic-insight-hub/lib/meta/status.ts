import { metaPost } from "./client";

export type MetaObjectType = "campaign" | "adset" | "ad";

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
        return { id: it.id, ok: false, error: (e as Error).message };
      }
    }),
  );
}
