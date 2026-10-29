import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { pushConfigured, sendPushToUser } from "@/lib/push";

// Etapa 221: botão "Mandar teste" do app no celular.
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    if (!pushConfigured()) throw new Error("Faltam as chaves VAPID na Vercel (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY).");
    const sent = await sendPushToUser(supabase, user.id, {
      title: "✅ Notificações ligadas",
      body: "É assim que os avisos urgentes vão chegar no seu celular.",
      url: "/m",
      tag: "teste",
    });
    if (sent === 0) throw new Error("Nenhum aparelho inscrito recebeu — toque em \"Ativar notificações\" de novo.");
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
