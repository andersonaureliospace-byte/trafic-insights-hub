import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { readCpaBoardCache, CPA_BOARD_CACHEABLE_PRESETS, type CpaBoardCachePreset } from "@/lib/meta/cpa-board-cache";

// Leitura do cache do Monitor de CPA (Etapa 61) — "Ontem" e "Últimos 3
// dias". Não chama a Meta nenhuma vez: só lê o que o hook diário
// (cpa-board-cache-tick) já deixou guardado em meta_insights_cache.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const preset = body.preset as CpaBoardCachePreset;
    if (!CPA_BOARD_CACHEABLE_PRESETS.includes(preset)) {
      return NextResponse.json({ error: `Período inválido para cache: ${preset}` }, { status: 400 });
    }
    const cache = await readCpaBoardCache(supabase, user.id, preset);
    return NextResponse.json({ cache });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
