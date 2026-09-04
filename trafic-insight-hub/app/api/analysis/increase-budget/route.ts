import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { increaseAdSetDailyBudget } from "@/lib/meta/budget";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const adsetId = body.adsetId as string | undefined;
    if (!adsetId) return NextResponse.json({ ok: false, error: "adsetId obrigatório" }, { status: 400 });

    const result = await increaseAdSetDailyBudget(token, adsetId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
