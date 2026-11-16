import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll } from "@/lib/meta/client";

// Etapa 321: histórico de mudanças de uma conta com POR ONDE foi feita (application_name) — pra saber se uma pausa veio
// do Hub (app do Hub na Meta) ou de alguém no Gerenciador, mesmo quando o login é o mesmo.
// GET ?account=662434509922357&since=2026-11-15T20:00:00-03:00&until=2026-11-15T21:00:00-03:00
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const u = new URL(request.url);
    const acc = (u.searchParams.get("account") ?? "").replace(/^act_/, "");
    if (!/^\d+$/.test(acc)) throw new Error("Informe ?account=ID da conta.");
    const until = u.searchParams.get("until") ? Date.parse(u.searchParams.get("until") as string) : Date.now();
    const since = u.searchParams.get("since") ? Date.parse(u.searchParams.get("since") as string) : until - 24 * 3600_000;
    const rows = await metaGetAll<Record<string, unknown>>(
      token,
      `/act_${acc}/activities`,
      {
        fields: "event_type,translated_event_type,event_time,actor_name,actor_id,application_id,application_name,object_id,object_name,object_type,extra_data",
        since: String(Math.floor(since / 1000)),
        until: String(Math.floor(until / 1000)),
        limit: "500",
      },
      10,
    );
    return NextResponse.json({ account: acc, count: rows.length, activities: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
