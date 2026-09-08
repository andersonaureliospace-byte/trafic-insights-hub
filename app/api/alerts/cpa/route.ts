import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkCpaAlerts } from "@/lib/alerts/cpa";

// Só calcula o status (não envia nada) — usado pra popular a tela.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, sendError } = await checkCpaAlerts(supabase, user.id, token, { send: false });
    return NextResponse.json({ statuses, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// "Verificar agora" — calcula e já envia o aviso pro grupo configurado.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, sendError } = await checkCpaAlerts(supabase, user.id, token, { send: true });
    return NextResponse.json({ statuses, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
