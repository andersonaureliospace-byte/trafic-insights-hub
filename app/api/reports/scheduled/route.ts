import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import type { Recurrence } from "@/lib/scheduling";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("scheduled_reports")
      .select(
        "id, template_id, ad_account_ids, wa_group_id, wa_group_name, recurrence, next_run_at, paused, created_at",
      )
      .eq("user_id", user.id)
      .order("next_run_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ reports: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const template_id = String(body.template_id ?? "");
    const ad_account_ids = (body.ad_account_ids ?? []) as string[];
    const wa_group_id = String(body.wa_group_id ?? "");
    const wa_group_name = String(body.wa_group_name ?? "");
    const recurrence = (body.recurrence ?? "daily") as Recurrence;
    const scheduledAt = String(body.scheduledAt ?? "");

    if (!template_id) throw new Error("Selecione um modelo de relatório.");
    if (!Array.isArray(ad_account_ids) || ad_account_ids.length === 0) {
      throw new Error("Selecione ao menos uma conta.");
    }
    if (!wa_group_id) throw new Error("Selecione o grupo do WhatsApp que vai receber o relatório.");
    if (!["daily", "weekly", "monthly"].includes(recurrence)) throw new Error("Recorrência inválida.");
    const firstRun = new Date(scheduledAt);
    if (Number.isNaN(firstRun.getTime())) throw new Error("Data/hora inválida.");

    const { data, error } = await supabase
      .from("scheduled_reports")
      .insert({
        user_id: user.id,
        template_id,
        ad_account_ids,
        wa_group_id,
        wa_group_name,
        recurrence,
        next_run_at: firstRun.toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Pausa/retoma um relatório agendado (sem apagar a configuração).
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("id obrigatório.");
    const paused = Boolean(body.paused);

    const { error } = await supabase
      .from("scheduled_reports")
      .update({ paused })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("id obrigatório.");
    const { error } = await supabase.from("scheduled_reports").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
