import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { loadGestorNumbers } from "@/lib/estrategia/auditorias/gestores";

// Etapa 325: manda uma nota do cliente no WhatsApp pessoal do gestor responsável pela conta (número em Configurações → Gestores).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const b = (await request.json().catch(() => ({}))) as { clienteId?: string; texto?: string };
    const id = String(b.clienteId ?? "").replace(/^act_/, "");
    const texto = String(b.texto ?? "").trim();
    if (!id || !texto) throw new Error("Plano de ação vazio.");
    const { data: rows, error } = await supabase
      .from("account_bindings")
      .select("client_name, responsible")
      .eq("user_id", user.id)
      .in("ad_account_id", [id, `act_${id}`])
      .limit(1);
    if (error) throw error;
    const cli = rows?.[0];
    const gestor = (cli?.responsible as string | null)?.trim();
    if (!gestor) throw new Error("Essa conta não tem gestor responsável na ficha.");
    const nums = await loadGestorNumbers(supabase as never, user.id);
    const num = nums.get(gestor.toLowerCase());
    if (!num) throw new Error(`${gestor} não tem WhatsApp cadastrado em Configurações → Gestores.`);
    const inst = await requireWhatsappInstance(supabase as never, user.id);
    await sendText({ api_url: inst.api_url, token: inst.token }, num, `📝 *Plano de ação — ${cli?.client_name ?? "conta"}*\n\n${texto}`);
    return NextResponse.json({ ok: true, gestor });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
