import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import type { CopyVariation } from "@/lib/copy/types";

// Etapa 70 (ajuste): banco de 5 variações fixas da subcategoria (ver
// migração 0019_copy_subcategory_bank.sql). PUT salva (ou substitui) as 5 —
// normalmente o texto que acabou de sair de uma geração por IA, revisado
// pelo usuário — e DELETE limpa o banco, voltando a gerar com IA
// normalmente pra essa subcategoria. Não passa pelo assertNotFixed de
// [id]/route.ts: uma subcategoria fixa (ex.: "Geral · Neutro") também pode
// ter banco — isso é independente de poder renomear/apagar a subcategoria
// em si.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const rawVariations = Array.isArray(body.variations) ? body.variations : [];
    if (rawVariations.length !== 5) {
      throw new Error("O banco precisa ter exatamente 5 variações.");
    }
    const variations: CopyVariation[] = rawVariations.map((v: Record<string, unknown>) => ({
      copy: String(v?.copy ?? "").trim(),
      oferta: String(v?.oferta ?? "").trim(),
      cta: String(v?.cta ?? "").trim(),
      condicao: String(v?.condicao ?? "").trim(),
    }));
    if (variations.some((v) => !v.copy)) {
      throw new Error("Todas as 5 variações precisam ter o texto da copy preenchido.");
    }

    const { error } = await supabase
      .from("copy_subcategories")
      .update({ bank_variations: variations })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const { error } = await supabase
      .from("copy_subcategories")
      .update({ bank_variations: [] })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
