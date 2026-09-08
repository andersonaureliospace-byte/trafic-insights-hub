import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAccountBreakdown, type BreakdownLevel } from "@/lib/meta/breakdown";
import type { DateRangeInput } from "@/lib/meta/client";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountId = String(body.accountId ?? "");
    const datePreset = (body.datePreset ?? "last_7d") as DateRangeInput;
    const level = (body.level ?? "campaign") as BreakdownLevel;

    const result = await getAccountBreakdown(token, accountId, datePreset, level);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
