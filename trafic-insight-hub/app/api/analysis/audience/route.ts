import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { audienceAccounts, computeAudienceAccounts, readAudienceSnapshot, saveAudienceAccounts } from "@/lib/meta/audience-snapshot";

// Etapa 164: Análise → Melhor público.
//  GET  → lista de contas + retrato guardado (números até ontem), sem consultar a Meta.
//  POST → recalcula as contas pedidas (lotes pequenos; o servidor tem 60s) e GUARDA no retrato.
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [accounts, snapshot] = await Promise.all([audienceAccounts(supabase, user.id), readAudienceSnapshot(supabase, user.id)]);
    return NextResponse.json({ accounts, snapshot });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const ids: string[] = Array.isArray(body.accountIds) ? (body.accountIds as string[]) : [];
    if (ids.length === 0) return NextResponse.json({ ok: true });
    const entries = await computeAudienceAccounts(supabase, user.id, token, ids);
    await saveAudienceAccounts(supabase, user.id, entries);
    return NextResponse.json({ ok: true, errors: entries.filter((e) => e.error).map((e) => `${e.clientName}: ${e.error}`) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
