import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

// Envio manual e imediato de uma mensagem de texto — usado pela aba
// Mensagens → Envio, um POST por destinatário selecionado (o cliente
// intercala com uma pequena espera entre os envios).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const body = await request.json();
    const groupId = String(body.groupId ?? "").trim();
    const text = String(body.text ?? "");
    if (!groupId) throw new Error("groupId obrigatório.");
    if (!text.trim()) throw new Error("Mensagem vazia.");
    if (text.length > 4096) throw new Error("Mensagem muito longa.");

    await sendText(inst, groupId, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
