import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { DEFAULT_SUBCATEGORIES } from "@/lib/copy/seed-defaults";
import type { CopyCategory } from "@/lib/copy/types";

const VALID_CATEGORIES: CopyCategory[] = ["geral", "promocao", "exames", "inauguracao"];

// Etapa 70: garante que cada subcategoria padrão (lib/copy/seed-defaults.ts)
// exista pro usuário, criando só as que ainda faltam — checagem por item
// (categoria + nome), não "só se a lista inteira estiver vazia". Isso deixa
// dar novos defaults no futuro (caso da "Neutro", adicionada depois que
// usuários já tinham semeado o conjunto original) sem duplicar nem
// sobrescrever nada que o usuário já tenha criado/mexido.
async function ensureDefaultSubcategories(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("copy_subcategories")
    .select("category, name")
    .eq("user_id", userId);
  if (existingError) throw existingError;
  const existingKeys = new Set((existing ?? []).map((s) => `${s.category}::${s.name}`));

  for (const seed of DEFAULT_SUBCATEGORIES) {
    if (existingKeys.has(`${seed.category}::${seed.name}`)) continue;

    const { data: sub, error: subError } = await supabase
      .from("copy_subcategories")
      .insert({
        user_id: userId,
        category: seed.category,
        name: seed.name,
        extra_fields: seed.extra_fields,
        oferta: seed.oferta,
        condicao: seed.condicao,
        tom: seed.tom,
        fixed: seed.fixed,
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
    await ensureDefaultSubcategories(supabase, user.id);

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
// Oferta/Condição/Tom são perguntados só aqui, na criação (pedido
// explícito) — não mais a cada geração. Todos opcionais: oferta vazia
// deixa a IA inferir o mecanismo pelos modelos de referência da
// subcategoria; condição/tom vazios usam os defaults (texto padrão de
// condição / tom neutro, resolvidos em app/api/copy/generate).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const category = String(body.category ?? "") as CopyCategory;
    const name = String(body.name ?? "").trim();
    const oferta = String(body.oferta ?? "").trim();
    const condicao = String(body.condicao ?? "").trim();
    const tom = String(body.tom ?? "").trim();
    if (!VALID_CATEGORIES.includes(category)) throw new Error("Categoria inválida.");
    if (!name) throw new Error("Nome da subcategoria é obrigatório.");

    const { data, error } = await supabase
      .from("copy_subcategories")
      .insert({ user_id: user.id, category, name, extra_fields: [], oferta, condicao, tom, fixed: false })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ subcategory: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
