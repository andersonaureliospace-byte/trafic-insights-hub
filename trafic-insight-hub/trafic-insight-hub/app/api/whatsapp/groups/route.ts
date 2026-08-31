import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { listGroups } from "@/lib/whatsapp/client";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const body = await request.json().catch(() => ({}));
    const groups = await listGroups(inst, body.force === true);
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
