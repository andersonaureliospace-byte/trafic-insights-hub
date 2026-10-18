import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { namingAccounts } from "@/lib/naming/scan";
import { offersForAccounts } from "@/lib/offers/scan";
import { readOffersSnapshot, saveOffersSnapshot } from "@/lib/offers/snapshot";

// Etapa 149: coluna "Ofertas ativas" da aba Descrição — GERAL / EXAME / PROMO / BOLETO do mês corrente, por conta IVS.
// GET = lê o retrato FIXO (gravado pela automação ~5h20 e ~12h, ou pelo ↻). POST = recalcula até 8 contas agora e grava no retrato.
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [snap, ivs] = await Promise.all([readOffersSnapshot(supabase, user.id), namingAccounts(supabase, user.id)]);
    return NextResponse.json({ accounts: snap.accounts, ivsIds: ivs.map((a) => a.ad_account_id.replace(/^act_/, "")) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown };
    const ids = Array.isArray(body.accountIds) ? body.accountIds.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    if (ids.length === 0) return NextResponse.json({ accounts: {}, failed: [] });
    const r = await offersForAccounts(supabase, user.id, token, ids);
    let at: string | null = null;
    if (Object.keys(r.offers).length > 0) at = await saveOffersSnapshot(supabase, user.id, r.offers);
    const accounts = Object.fromEntries(Object.entries(r.offers).map(([id, summary]) => [id, { at: at as string, summary }]));
    return NextResponse.json({ accounts, failed: r.failed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
