import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { listGroups } from "@/lib/whatsapp/client";

// Etapa 244: todos os grupos do seu WhatsApp (pra escolher quais aparecem no espelho).
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const force = new URL(request.url).searchParams.get("force") === "1";
    const groups = await listGroups({ api_url: inst.api_url, token: inst.token }, force);
    groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
