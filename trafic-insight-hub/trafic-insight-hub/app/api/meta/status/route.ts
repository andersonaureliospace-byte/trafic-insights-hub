import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { setEntitiesStatus, type MetaObjectType } from "@/lib/meta/status";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const items = (body.items ?? []) as { id: string; type: MetaObjectType }[];
    const status = body.status as "ACTIVE" | "PAUSED";

    const results = await setEntitiesStatus(token, items, status);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
