import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { waFetch, extractConnect } from "@/lib/whatsapp/client";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const body = await request.json().catch(() => ({}));
    const phone = String(body.phone ?? "").trim();
    if (phone && !/^\d{10,15}$/.test(phone)) {
      throw new Error("Telefone deve ter DDI+DDD+número (10 a 15 dígitos).");
    }

    const json = await waFetch(inst, "/instance/connect", {
      method: "POST",
      body: JSON.stringify(phone ? { phone } : {}),
    });
    const result = extractConnect(json);
    await supabase.from("whatsapp_instances").update({ status: result.status }).eq("id", inst.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
