import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkNoDelivery } from "@/lib/alerts/no-delivery";

// Etapa 138: GET = só mostra quem está sem anúncio ativo / sem entrega agora (ignora o horário, não envia nada);
// POST = confere e envia o alerta agora (ignorando o horário 8h–21h).
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const r = await checkNoDelivery(supabase, user.id, token, { send: false, ignoreHours: true });
    return NextResponse.json({ items: r.items.map((i) => i.line), failedAccounts: r.failedAccounts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const r = await checkNoDelivery(supabase, user.id, token, { send: true, ignoreHours: true });
    return NextResponse.json({ items: r.items.map((i) => i.line), failedAccounts: r.failedAccounts, sendError: r.sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
