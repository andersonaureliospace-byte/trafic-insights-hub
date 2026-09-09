import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import type { DispatchTarget, Recurrence } from "@/lib/whatsapp/dispatch";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("whatsapp_scheduled_dispatches")
      .select(
        "id, message, targets, scheduled_at, recurrence, status, last_run_at, last_error, created_at",
      )
      .eq("user_id", user.id)
      .in("status", ["pending", "running", "error"])
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ dispatches: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const message = String(body.message ?? "").trim();
    const targets = (body.targets ?? []) as DispatchTarget[];
    const recurrence = (body.recurrence ?? "none") as Recurrence;
    const scheduledAt = String(body.scheduledAt ?? "");

    if (!message) throw new Error("Mensagem obrigatória.");
    if (message.length > 4096) throw new Error("Mensagem muito longa.");
    if (!Array.isArray(targets) || targets.length === 0) throw new Error("Selecione ao menos um destinatário.");
    if (!["none", "daily", "weekly", "monthly"].includes(recurrence)) throw new Error("Recorrência inválida.");
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) throw new Error("Data inválida.");

    const { data, error } = await supabase
      .from("whatsapp_scheduled_dispatches")
      .insert({
        user_id: user.id,
        message,
        targets,
        scheduled_at: scheduledDate.toISOString(),
        recurrence,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Cancela um agendamento (pending/error -> cancelled).
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("id obrigatório.");

    const { error } = await supabase
      .from("whatsapp_scheduled_dispatches")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("user_id", user.id)
      .in("status", ["pending", "error"]);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
