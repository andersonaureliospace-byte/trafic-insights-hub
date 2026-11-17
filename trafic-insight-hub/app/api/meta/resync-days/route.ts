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
    const body = (await request.json()) as { accountIds?: string[]; days?: number; since?: string; until?: string };
    const ids = (body.accountIds ?? []).map(String).filter(Boolean).slice(0, 5);
    if (!ids.length) throw new Error("Informe as contas.");
    // Etapa 317: por padrão refaz os últimos 7 dias (37 por conjunto passava do tempo da Vercel); { days: 37 } refaz tudo.
    const dias = Math.max(1, Math.min(37, Number(body.days) || 7));
    const ontem = ymd(new Date(Date.now() - 86_400_000));
    const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    // Etapa 326: { since, until } refaz um pedaço específico (pra recompor o histórico em partes, sem estourar o tempo)
    const range =
      isYmd(body.since) && isYmd(body.until) && (body.since as string) <= (body.until as string)
        ? { since: body.since as string, until: (body.until as string) > ontem ? ontem : (body.until as string) }
        : { since: ymd(new Date(Date.now() - dias * 86_400_000)), until: ontem };
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
