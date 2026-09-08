import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAccountsInsights } from "@/lib/meta/insights";
import type { DateRangeInput } from "@/lib/meta/client";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds = (body.accountIds ?? []) as string[];
    const datePreset = (body.datePreset ?? "last_7d") as DateRangeInput;

    if (accountIds.length === 0) return NextResponse.json({ insights: {} });

    const insights = await getAccountsInsights(token, accountIds, datePreset);
    return NextResponse.json({ insights });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
