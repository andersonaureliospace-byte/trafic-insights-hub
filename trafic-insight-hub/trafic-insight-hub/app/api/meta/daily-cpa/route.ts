import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAccountsDailyCpa } from "@/lib/meta/daily-cpa";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds = (body.accountIds ?? []) as string[];
    const days = Number(body.days ?? 3);
    const includeToday = Boolean(body.includeToday);

    const result = await getAccountsDailyCpa(token, accountIds, days, includeToday);
    return NextResponse.json({ daily: result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
