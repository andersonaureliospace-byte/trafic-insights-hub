import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { DEFAULT_SUBCATEGORIES } from "@/lib/copy/seed-defaults";
import type { CopyCategory } from "@/lib/copy/types";

const VALID_CATEGORIES: CopyCategory[] = ["geral", "promocao", "exames", "inauguracao"];

// Etapa 70: na primeira vez que o usuário abre a aba Copy (nenhuma
// subcategoria cadastrada ainda), semeia as subcategorias + modelos de
// referência padrão (lib/copy/seed-defaults.ts) — assim a aba já nasce
// utilizável, sem precisar de uma tela de setup separada.
async function seedDefaultsIfEmpty(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
) {
  const { count } = await supabase
    .from("copy_subcategories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return;

  for (let i = 0; i < DEFAULT_SUBCATEGORIES.length; i++) {
    const seed = DEFAULT_SUBCATEGORIES[i];
    const { data: sub, error: subError } = await supabase
      .from("copy_subcategories")
      .insert({
        user_id: userId,
        category: seed.category,
        name: seed.name,
        extra_fields: seed.extra_fields,
        sort_order: i,
      })
      .select("id")
      .single();
    if (subError) throw subError;

    if (seed.models.length > 0) {
      const { error: modelsError } = await supabase.from("copy_reference_models").insert(
        seed.models.map((m, j) => ({
          user_id: userId,
          subcategory_id: sub.id,
          endereco_exemplo: m.endereco_exemplo,
          copy: m.copy,
          oferta: m.oferta,
          cta: m.cta,
          condicao: m.condicao,
          sort_order: j,
        })),
      );
      if (modelsError) throw modelsError;
    }
  }
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    await seedDefaultsIfEmpty(supabase, user.id);

    const { data, error } = await supabase
      .from("copy_subcategories")
      .select("*")
      .eq("user_id", user.id)
      .order("category")
      .order("sort_order");
    if (error) throw error;
    return NextResponse.json({ subcategories: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Cria uma subcategoria nova dentro de uma das 4 categorias fixas — o
// usuário pode criar quantas quiser, as categorias em si nunca mudam.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const category = String(body.category ?? "") as CopyCategory;
    const name = String(body.name ?? "").trim();
    if (!VALID_CATEGORIES.includes(category)) throw new Error("Categoria inválida.");
    if (!name) throw new Error("Nome da subcategoria é obrigatório.");

    const { data, error } = await supabase
      .from("copy_subcategories")
      .insert({ user_id: user.id, category, name, extra_fields: [] })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ subcategory: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
