import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Renomear ou apagar uma subcategoria — as 4 categorias fixas nunca passam
// por aqui (não têm id próprio, são só o enum `category`).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
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
    const { error } = await supabase.from("copy_subcategories").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
