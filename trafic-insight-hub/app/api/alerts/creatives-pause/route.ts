import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkAndPauseCreatives } from "@/lib/alerts/creatives-pause";

// Sem GET/preview de propósito: ao contrário de Saldo/Pagamento/CPA (que só
// avisam), aqui o próprio "check" já pausa quem estiver acima da meta —
// mesmo comportamento já usado em Auditoria > Erros de veiculação. Por isso
// só existe o botão "Verificar e pausar agora" (POST), nunca roda sozinho
// ao abrir a aba.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { paused, sendError } = await checkAndPauseCreatives(supabase, user.id, token, { send: true });
    return NextResponse.json({ paused, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
