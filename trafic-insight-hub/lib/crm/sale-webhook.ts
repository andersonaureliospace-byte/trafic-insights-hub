// Quando um lead entra no estágio "venda", o app notifica o n8n direto
// (POST síncrono pro sale_webhook_url cadastrado na instância) — diferente
// dos hooks de auditoria/disparo, aqui não é o n8n que puxa, é o app que
// empurra. Fica registrado em crm_sale_webhook_deliveries pra dar pra
// conferir depois (inclusive se a entrega falhou).

import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

interface LeadForWebhook {
  id: string;
  name: string;
  phone: string | null;
  source: unknown;
}

interface InstanceForWebhook {
  id: string;
  name: string;
  sale_webhook_url: string | null;
}

export async function notifySale(db: Db, instance: InstanceForWebhook, lead: LeadForWebhook): Promise<void> {
  if (!instance.sale_webhook_url) return;

  const payload = {
    event: "venda_registrada",
    instance: { id: instance.id, name: instance.name },
    lead: { id: lead.id, name: lead.name, phone: lead.phone, source: lead.source },
    at: new Date().toISOString(),
  };

  const { data: delivery, error: insertErr } = await db
    .from("crm_sale_webhook_deliveries")
    .insert({ lead_id: lead.id, payload, status: "pending" })
    .select("id")
    .single();
  if (insertErr || !delivery) return;

  try {
    const res = await fetch(instance.sale_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await db
      .from("crm_sale_webhook_deliveries")
      .update({ status: res.ok ? "sent" : "error", delivered_at: new Date().toISOString() })
      .eq("id", delivery.id);
  } catch {
    await db
      .from("crm_sale_webhook_deliveries")
      .update({ status: "error", delivered_at: new Date().toISOString() })
      .eq("id", delivery.id);
  }
}
