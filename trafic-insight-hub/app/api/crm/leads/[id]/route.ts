import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { isLeadStatus } from "@/lib/crm/pipeline";
import { notifySale } from "@/lib/crm/sale-webhook";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireUser();
    const body = await request.json();

    const { data: current, error: curErr } = await supabase
      .from("crm_leads")
      .select("id, crm_instance_id, name, phone, status")
      .eq("id", id)
      .single();
    if (curErr) throw curErr;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) throw new Error("Nome é obrigatório.");
      patch.name = name;
    }
    if ("phone" in body) {
      patch.phone = body.phone ? String(body.phone).trim() : null;
    }

    let statusChanged = false;
    let newStatus: string | null = null;
    if ("status" in body) {
      newStatus = String(body.status ?? "");
      if (!isLeadStatus(newStatus)) throw new Error("Status inválido.");
      if (newStatus !== current.status) {
        patch.status = newStatus;
        statusChanged = true;
      }
    }

    const { data: updated, error } = await supabase
      .from("crm_leads")
      .update(patch)
      .eq("id", id)
      .select("id, crm_instance_id, name, phone, status, source, created_at, updated_at")
      .single();
    if (error) throw error;

    if (statusChanged && newStatus) {
      await supabase.from("crm_lead_events").insert({
        lead_id: id,
        event_type: "status_change",
        from_status: current.status,
        to_status: newStatus,
      });

      if (newStatus === "venda") {
        const { data: instance } = await supabase
          .from("crm_instances")
          .select("id, name, sale_webhook_url")
          .eq("id", current.crm_instance_id)
          .single();
        if (instance) {
          await notifySale(supabase, instance, {
            id: updated.id,
            name: updated.name,
            phone: updated.phone,
            source: updated.source,
          });
        }
      }
    }

    return NextResponse.json({ lead: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireUser();
    const { error } = await supabase.from("crm_leads").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
