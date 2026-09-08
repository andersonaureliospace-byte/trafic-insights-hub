import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) throw new Error("Nome é obrigatório.");
      patch.name = name;
    }
    if ("sale_webhook_url" in body) {
      const url = String(body.sale_webhook_url ?? "").trim();
      patch.sale_webhook_url = url || null;
    }

    const { error } = await supabase.from("crm_instances").update(patch).eq("id", id).eq("user_id", user.id);
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
    const { error } = await supabase.from("crm_instances").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
