import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { offersForAccounts } from "@/lib/offers/scan";

// Etapa 149: coluna "Ofertas ativas" da aba Descrição — GERAL / EXAME / PROMO / BOLETO do mês corrente, por conta IVS.
// A tela manda poucas contas por vez (até 8) pra não estourar o tempo da função.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown };
    const ids = Array.isArray(body.accountIds) ? body.accountIds.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    if (ids.length === 0) return NextResponse.json({ offers: {}, failed: [], notIvs: [] });
    return NextResponse.json(await offersForAccounts(supabase, user.id, token, ids));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
