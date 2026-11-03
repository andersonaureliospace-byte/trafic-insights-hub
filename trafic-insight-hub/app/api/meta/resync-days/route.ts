import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { syncAccountDays } from "@/lib/meta/daily-store";

// Etapa 247: refaz o backup diário (dias fechados, últimos 37 dias) de até 5 contas — usado quando a regra de contar
// resultado muda (ex.: lead de formulário da Ijuí) e os dias já guardados ficaram com o número antigo.
export const maxDuration = 60;

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { accountIds?: string[] };
    const ids = (body.accountIds ?? []).map(String).filter(Boolean).slice(0, 5);
    if (!ids.length) throw new Error("Informe as contas.");
    const range = { since: ymd(new Date(Date.now() - 37 * 86_400_000)), until: ymd(new Date(Date.now() - 86_400_000)) };
    const out: Array<{ id: string; days?: number; error?: string }> = [];
    for (const id of ids) {
      try {
        out.push({ id, days: await syncAccountDays(token, id.startsWith("act_") ? id : `act_${id}`, range) });
      } catch (e) {
        out.push({ id, error: (e as Error).message });
      }
    }
    return NextResponse.json({ ok: true, range, out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
