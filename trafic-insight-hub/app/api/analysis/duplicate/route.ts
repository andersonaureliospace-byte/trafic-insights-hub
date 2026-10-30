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
      ads?: Array<{ id: string; name: string; status?: string }>;
      dailyBudget?: number | null;
      ageMin?: number | null;
      ageMax?: number | null;
      startTime?: string | null;
    };
    if (!body.adsetId) return NextResponse.json({ ok: false, error: "adsetId obrigatório" }, { status: 400 });
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Informe o nome do conjunto novo." }, { status: 400 });
    const ads = (body.ads ?? [])
      .filter((a) => a?.id)
      .map((a) => ({ id: a.id, name: a.name, status: a.status === "ACTIVE" || a.status === "PAUSED" ? (a.status as "ACTIVE" | "PAUSED") : undefined }));
    if (ads.length === 0) return NextResponse.json({ ok: false, error: "Escolha pelo menos um criativo." }, { status: 400 });
    const budgetCents = body.dailyBudget != null && Number.isFinite(body.dailyBudget) && body.dailyBudget > 0 ? Math.round(body.dailyBudget * 100) : null;
    // Etapa 231: idade (18–65) e início (ISO com fuso) opcionais.
    const ageOk = Number.isInteger(body.ageMin) && Number.isInteger(body.ageMax) && (body.ageMin as number) >= 18 && (body.ageMax as number) <= 65 && (body.ageMin as number) <= (body.ageMax as number);
    const startTime = typeof body.startTime === "string" && !Number.isNaN(Date.parse(body.startTime)) ? body.startTime : null;
    const result = await duplicateAdSet(token, {
      adsetId: body.adsetId,
      adIds: ads,
      newName: name,
      dailyBudgetCents: budgetCents,
      ageMin: ageOk ? body.ageMin : null,
      ageMax: ageOk ? body.ageMax : null,
      startTime,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
