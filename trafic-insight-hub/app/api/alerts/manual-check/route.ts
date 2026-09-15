import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { checkManualReviews } from "@/lib/alerts/manual-check";

// Só calcula o status (não envia nada) — usado pra popular o Controle de Saldo.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { statuses, sendError } = await checkManualReviews(supabase, user.id, { send: false });
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
    const { statuses, sendError } = await checkManualReviews(supabase, user.id, { send: true, bypassCooldown: true });
    return NextResponse.json({ statuses, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
