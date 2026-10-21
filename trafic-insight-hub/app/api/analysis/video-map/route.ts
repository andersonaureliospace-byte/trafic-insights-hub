import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { computeAccounts, readVideoSnapshot, saveSnapshotAccounts } from "@/lib/meta/video-snapshot";
import { loadVideoBank } from "@/lib/meta/video-bank-store";

// Etapa 160/161: mapeamento dos vídeos de GERAL (Análise → Vídeos).
//  GET  → devolve o retrato guardado (números até ontem) + a lista de vídeos (Configurações → Vídeos gerais), sem consultar a Meta.
//  POST → recalcula as contas pedidas (a tela manda em lotes pequenos, o servidor tem 60s) e GUARDA no retrato.
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const snap = await readVideoSnapshot(supabase, user.id);
    return NextResponse.json({ snapshot: snap, bank: await loadVideoBank(supabase, user.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds: string[] = Array.isArray(body.accountIds) ? (body.accountIds as string[]) : [];
    if (accountIds.length === 0) return NextResponse.json({ accounts: [], skipped: [] });
    const { entries, skipped } = await computeAccounts(supabase, user.id, token, accountIds);
    await saveSnapshotAccounts(supabase, user.id, entries);
    return NextResponse.json({ accounts: entries, skipped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
