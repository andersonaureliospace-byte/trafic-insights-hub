import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkAndPauseCreatives } from "@/lib/alerts/creatives-pause";

// Sem GET/preview de propósito: ao contrário de Saldo/Pagamento/CPA (que só
// avisam), aqui o próprio "check" já pausa quem estiver acima da meta —
// mesmo comportamento já usado em Auditoria > Erros de veiculação. Por isso
// só existe o botão "Verificar e pausar agora" (POST), nunca roda sozinho
// ao abrir a aba.
// Etapa 206: corpo opcional { "accountId": "..." } = varre só essa conta e devolve o diagnóstico (o que viu e por que
// cada criativo acima do limite foi ou não pausado). Usado pelo botão do Registro das automações.
// Etapa 213: "Todas as contas" no botão do Registro varre tudo — pede o tempo máximo (a rotina se limita a ~52s).
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    let onlyAccountId: string | undefined;
    try {
      const body = (await request.json()) as { accountId?: string };
      if (body?.accountId) onlyAccountId = body.accountId;
    } catch {
      // sem corpo: todas as contas
    }
    const { paused, held, sendError, diag } = await checkAndPauseCreatives(supabase, user.id, token, { send: true, onlyAccountId });
    return NextResponse.json({ paused, held, sendError, diag });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
