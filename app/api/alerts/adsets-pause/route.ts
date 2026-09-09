import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkAndPauseAdSets } from "@/lib/alerts/adsets-pause";

// Sem GET/preview de propósito — mesmo motivo de creatives-pause: o check já
// pausa quem estiver acima da meta, só o botão manual (POST) existe.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { paused, sendError } = await checkAndPauseAdSets(supabase, user.id, token, { send: true });
    return NextResponse.json({ paused, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
