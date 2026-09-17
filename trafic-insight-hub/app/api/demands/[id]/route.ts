import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Atribuição manual de cliente (Etapa 68, ajuste) — quando a demanda chega
// sem o nome do cliente (a pessoa não mandou a 2ª mensagem) ela fica em
// aberto; esse PATCH deixa vincular a uma conta já cadastrada depois, direto
// pela aba Demandas.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = body.ad_account_id ? String(body.ad_account_id) : null;
    const client_name = body.client_name ? String(body.client_name) : null;
    const client_name_raw = body.client_name_raw != null ? String(body.client_name_raw) : undefined;

    const patch: Record<string, unknown> = { ad_account_id, client_name };
    if (client_name_raw !== undefined) patch.client_name_raw = client_name_raw;

    const { error } = await supabase.from("demands").update(patch).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// "Finalizar" (Etapa 68) — pedido explícito: não existe status "concluída",
// finalizar já apaga a linha direto, sem manter histórico.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("demands").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
