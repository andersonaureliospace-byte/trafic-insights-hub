import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { duplicateAdSet, getDuplicateInfo } from "@/lib/meta/duplicate";

// Etapa 159: duplicar conjunto (Análise > CPA abaixo da meta). GET = dados pra janelinha (nome sugerido, orçamento, criativos ativos);
// POST = cria a cópia PAUSADA com os criativos escolhidos. Sempre devolve a mensagem exata da Meta quando algo falha.
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const adsetId = new URL(request.url).searchParams.get("adsetId");
    if (!adsetId) return NextResponse.json({ error: "adsetId obrigatório" }, { status: 400 });
    return NextResponse.json(await getDuplicateInfo(token, adsetId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as {
      adsetId?: string;
      name?: string;
      ads?: Array<{ id: string; name: string }>;
      dailyBudget?: number | null;
    };
    if (!body.adsetId) return NextResponse.json({ ok: false, error: "adsetId obrigatório" }, { status: 400 });
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Informe o nome do conjunto novo." }, { status: 400 });
    const ads = (body.ads ?? []).filter((a) => a?.id);
    if (ads.length === 0) return NextResponse.json({ ok: false, error: "Escolha pelo menos um criativo." }, { status: 400 });
    const budgetCents = body.dailyBudget != null && Number.isFinite(body.dailyBudget) && body.dailyBudget > 0 ? Math.round(body.dailyBudget * 100) : null;
    const result = await duplicateAdSet(token, { adsetId: body.adsetId, adIds: ads, newName: name, dailyBudgetCents: budgetCents });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
