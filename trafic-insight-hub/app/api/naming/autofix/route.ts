import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { runNamingAutoFix } from "@/lib/naming/scan";

// Etapa 140: roda agora o ajuste automático de idade/data dos conjuntos (o mesmo que o agendamento diário faz).
export const maxDuration = 60;

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const r = await runNamingAutoFix(supabase, user.id, token, { send: true });
    return NextResponse.json({ ok: true, fixed: r.fixed.length, failed: r.failed.length, failedAccounts: r.failedAccounts, sendError: r.sendError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
