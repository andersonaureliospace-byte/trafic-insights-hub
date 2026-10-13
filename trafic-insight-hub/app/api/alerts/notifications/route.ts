import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { purgeExpiredAlerts } from "@/lib/alerts/notifications";

// Etapa 112: aba "Alertas". Lista as notificações das verificações automáticas.
// Já limpa as vencidas (72h) antes de listar. Com ?count=1 devolve só quantas estão abertas
// (usado pela bolinha ao lado do nome da aba).
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    await purgeExpiredAlerts(supabase, user.id);

    if (new URL(request.url).searchParams.get("count")) {
      const { count, error } = await supabase
        .from("alert_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ count: count ?? 0 });
    }

    const { data, error } = await supabase
      .from("alert_notifications")
      .select("id, kind, title, body, item_count, sent_to_group, created_at, updated_at, expires_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return NextResponse.json({ notifications: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// "OK": apaga a notificação (?id=...) ou todas (?all=1).
export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      const { error } = await supabase.from("alert_notifications").delete().eq("user_id", user.id).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (params.get("all")) {
      const { error } = await supabase.from("alert_notifications").delete().eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    throw new Error("Informe id ou all.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
