import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { pauseAndDuplicateAdSet } from "@/lib/meta/adset-refresh";

// Painel > Análise: botão "Pausar e recriar conjunto" — pausa o anúncio,
// pausa o conjunto e cria uma cópia pausada (rascunho) com todos os
// anúncios originais. Ver lib/meta/adset-refresh.ts para o fluxo completo.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const adId = body.adId as string | undefined;
    const adsetId = body.adsetId as string | undefined;
    if (!adId || !adsetId) {
      return NextResponse.json({ error: "adId e adsetId são obrigatórios." }, { status: 400 });
    }
    const result = await pauseAndDuplicateAdSet(token, adId, adsetId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
