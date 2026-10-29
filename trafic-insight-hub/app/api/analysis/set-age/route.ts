import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet, metaPost } from "@/lib/meta/client";

// Etapa 227: Análise → "Conjuntos da conta" — muda a faixa etária (idade mínima e máxima) de um conjunto.
// A Meta SUBSTITUI o público inteiro na gravação, então lê o público atual, troca só a idade e manda tudo de volta.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adsetId?: string; ageMin?: number; ageMax?: number };
    const adsetId = String(body.adsetId ?? "").trim();
    const ageMin = Math.round(Number(body.ageMin));
    const ageMax = Math.round(Number(body.ageMax));
    if (!adsetId) throw new Error("Conjunto obrigatório.");
    if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) {
      throw new Error("Faixa etária inválida — use de 18 a 65 anos, com a mínima menor ou igual à máxima.");
    }

    const cur = await metaGet<{ targeting?: Record<string, unknown> }>(token, `/${adsetId}`, { fields: "targeting" });
    if (!cur.targeting) throw new Error("A Meta não devolveu o público do conjunto.");
    const from = { min: Number(cur.targeting.age_min ?? 18), max: Number(cur.targeting.age_max ?? 65) };
    const targeting = { ...cur.targeting, age_min: ageMin, age_max: ageMax };
    await metaPost(token, `/${adsetId}`, { targeting: JSON.stringify(targeting) });
    return NextResponse.json({ ok: true, from, ageMin, ageMax });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
