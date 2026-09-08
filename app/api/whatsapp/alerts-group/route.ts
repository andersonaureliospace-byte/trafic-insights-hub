import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const alerts_group_id = body.alerts_group_id ? String(body.alerts_group_id) : null;
    const alerts_group_name = body.alerts_group_name ? String(body.alerts_group_name) : null;

    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ alerts_group_id, alerts_group_name, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
