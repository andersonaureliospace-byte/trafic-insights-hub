import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Endpoint público chamado pelo n8n quando um lead novo chega (formulário,
// WhatsApp, etc.) — cai direto na instância certa do CRM. Roteado pelo
// public_token da instância (o mesmo token do link público /c/:token, que
// já é compartilhado com o cliente) e protegido pelo segredo compartilhado
// dos hooks internos (x-webhook-secret), pra ninguém conseguir jogar leads
// falsos só por ter visto o link público.
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const publicToken = String(body.public_token ?? "").trim();
    const name = String(body.name ?? "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const source = body.source ?? null;
    if (!publicToken) throw new Error("public_token é obrigatório.");
    if (!name) throw new Error("name é obrigatório.");

    const supabase = createServiceClient();
    const { data: instance, error: instErr } = await supabase
      .from("crm_instances")
      .select("id")
      .eq("public_token", publicToken)
      .maybeSingle();
    if (instErr) throw instErr;
    if (!instance) return NextResponse.json({ error: "Instância não encontrada para esse public_token." }, { status: 404 });

    const { data: lead, error: leadErr } = await supabase
      .from("crm_leads")
      .insert({ crm_instance_id: instance.id, name, phone, status: "novo", source })
      .select("id")
      .single();
    if (leadErr) throw leadErr;

    await supabase.from("crm_lead_events").insert({
      lead_id: lead.id,
      event_type: "created",
      to_status: "novo",
      note: "Lead recebido via n8n.",
    });

    return NextResponse.json({ ok: true, lead_id: lead.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
