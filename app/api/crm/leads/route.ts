import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("instance_id");
    if (!instanceId) throw new Error("instance_id é obrigatório.");

    const { data, error } = await supabase
      .from("crm_leads")
      .select("id, crm_instance_id, name, phone, status, source, created_at, updated_at")
      .eq("crm_instance_id", instanceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ leads: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await request.json();
    const crm_instance_id = String(body.instance_id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    if (!crm_instance_id) throw new Error("instance_id é obrigatório.");
    if (!name) throw new Error("Nome é obrigatório.");

    const { data: lead, error } = await supabase
      .from("crm_leads")
      .insert({ crm_instance_id, name, phone, status: "novo" })
      .select("id, crm_instance_id, name, phone, status, source, created_at, updated_at")
      .single();
    if (error) throw error;

    await supabase.from("crm_lead_events").insert({
      lead_id: lead.id,
      event_type: "created",
      to_status: "novo",
      note: "Lead criado manualmente no painel.",
    });

    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
