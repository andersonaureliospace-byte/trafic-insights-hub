import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { waFetch } from "@/lib/whatsapp/client";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const json = await waFetch<Record<string, unknown>>(inst, "/instance/status");
    const instance = (json?.instance ?? json) as Record<string, unknown> | undefined;
    const status = (instance?.status as string) || (json?.status as string) || "unknown";
    const connected = status === "connected" || status === "open";

    await supabase.from("whatsapp_instances").update({ status }).eq("id", inst.id);
    return NextResponse.json({ status, connected });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
