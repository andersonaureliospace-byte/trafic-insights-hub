import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Grupo dedicado a receber solicitações de Demandas (Etapa 68) — separado do
// grupo de alertas (alerts_group_id), que só recebe avisos automáticos.
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const demands_group_id = body.demands_group_id ? String(body.demands_group_id) : null;
    const demands_group_name = body.demands_group_name ? String(body.demands_group_name) : null;

    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ demands_group_id, demands_group_name, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
