import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import {
  readCpaBoardCache,
  cpaBoardCacheIsCurrent,
  refreshCpaBoardCacheForUser,
  CPA_BOARD_CACHEABLE_PRESETS,
  type CpaBoardCachePreset,
} from "@/lib/meta/cpa-board-cache";

// O recálculo (todas as contas direto na Meta) pode demorar; dá mais tempo à função.
export const maxDuration = 60;

// Leitura do cache do Monitor de CPA (Etapa 61; Etapa 148: recalcula sozinho se for de outro dia) — "Ontem" e "Últimos 3
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
    let cache = await readCpaBoardCache(supabase, user.id, preset);
    // Cache de outro dia (ou ainda inexistente) = "Ontem" errado. Recalcula na hora, direto na Meta. Se a Meta
    // falhar, devolve o que tinha, marcado como antigo (a tela avisa), em vez de mostrar número de outro dia sem aviso.
    let stale = false;
    if (!cpaBoardCacheIsCurrent(cache)) {
      try {
        const token = await getUserMetaToken(supabase, user.id);
        await refreshCpaBoardCacheForUser(supabase, user.id, token);
        cache = await readCpaBoardCache(supabase, user.id, preset);
      } catch {
        stale = cache != null;
      }
    }
    return NextResponse.json({ cache, stale });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
