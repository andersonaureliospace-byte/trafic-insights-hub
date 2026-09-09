import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { waFetch } from "@/lib/whatsapp/client";

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    await waFetch(inst, "/instance/disconnect", { method: "POST" });
    await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("id", inst.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
