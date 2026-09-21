import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Renomear ou apagar uma subcategoria — as 4 categorias fixas nunca passam
// por aqui (não têm id próprio, são só o enum `category`). Subcategorias
// `fixed` (hoje só "Geral · Neutro") não podem ser renomeadas nem apagadas
// pela tela — pedido explícito do usuário pra sempre existir uma opção sem
// tom nenhum.
async function assertNotFixed(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  id: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("copy_subcategories")
    .select("fixed")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (data?.fixed) {
    throw new Error("Essa subcategoria é fixa e não pode ser apagada ou renomeada.");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    await assertNotFixed(supabase, id, user.id);
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("Nome da subcategoria é obrigatório.");

    const { error } = await supabase
      .from("copy_subcategories")
      .update({ name })
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
    await assertNotFixed(supabase, id, user.id);
    const { error } = await supabase.from("copy_subcategories").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
