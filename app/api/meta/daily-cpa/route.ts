import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { getAccountsDailyCpa, getAccountsMonthCpa } from "@/lib/meta/daily-cpa";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const accountIds = (body.accountIds ?? []) as string[];
    const days = Number(body.days ?? 3);
    const includeToday = Boolean(body.includeToday);
    // Etapa 48: coluna "Mensal" de Evolução — mesma chamada, só que agregada
    // no mês corrente inteiro, opcional pra não pesar quem não precisa dela.
    const includeMonth = Boolean(body.includeMonth);

    const [daily, month] = await Promise.all([
      getAccountsDailyCpa(token, accountIds, days, includeToday),
      includeMonth ? getAccountsMonthCpa(token, accountIds) : Promise.resolve(null),
    ]);
    return NextResponse.json({ daily, ...(month ? { month } : {}) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
