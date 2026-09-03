import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { pauseAdSetAndTag } from "@/lib/meta/adset-pause-and-tag";

// Painel > Análise: botão "⏸️ Pausar conjunto" — pausa o anúncio, pausa o
// conjunto e acrescenta "AQUI" no final do nome dele. Ver
// lib/meta/adset-pause-and-tag.ts para o porquê de não duplicar mais.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const adId = body.adId as string | undefined;
    const adsetId = body.adsetId as string | undefined;
    const adsetName = body.adsetName as string | undefined;
    if (!adId || !adsetId) {
      return NextResponse.json({ error: "adId e adsetId são obrigatórios." }, { status: 400 });
    }
    const result = await pauseAdSetAndTag(token, adId, adsetId, adsetName ?? "");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
