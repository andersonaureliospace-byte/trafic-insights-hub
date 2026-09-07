import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkPaymentErrors } from "@/lib/alerts/payment";

// Só calcula o status (não envia nada) — usado pra popular a tela.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, sendError } = await checkPaymentErrors(supabase, user.id, token, { send: false });
    return NextResponse.json({ statuses, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// "Verificar agora" — calcula e já envia o aviso pro grupo configurado
// (ignora o cooldown de 24h, já que foi um pedido explícito).
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, sendError } = await checkPaymentErrors(supabase, user.id, token, { send: true, bypassCooldown: true });
    return NextResponse.json({ statuses, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
