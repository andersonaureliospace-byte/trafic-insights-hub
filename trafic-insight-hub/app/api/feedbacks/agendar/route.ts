import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { gravarAgendados, lerAgendados } from "@/lib/feedbacks/agendados";

// Etapa 315: programar / cancelar / listar o envio de um feedback.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json({ agendados: await lerAgendados(supabase as never, user.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const b = (await request.json().catch(() => ({}))) as { id?: string; quando?: string; resumo?: string; proximo?: string | null };
    const id = String(b.id ?? "");
    const quando = b.quando ? new Date(b.quando) : null;
    if (!id || !quando || Number.isNaN(quando.getTime())) throw new Error("Informe o dia e a hora do envio.");
    if (quando.getTime() < Date.now() - 60_000) throw new Error("Escolha um horário daqui pra frente.");
    const { data: fb, error } = await supabase.from("client_feedbacks").select("id, client_name, status").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!fb) throw new Error("Feedback não encontrado.");
    if (fb.status === "enviado") throw new Error("Esse feedback já foi enviado.");
    if (typeof b.resumo === "string") {
      await supabase.from("client_feedbacks").update({ resumo: b.resumo, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    }
    const list = (await lerAgendados(supabase as never, user.id)).filter((a) => a.id !== id);
    list.push({ id, quando: quando.toISOString(), proximo: b.proximo ?? null, cliente: (fb.client_name as string | null) ?? null });
    await gravarAgendados(supabase as never, user.id, list);
    return NextResponse.json({ ok: true, quando: quando.toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const list = await lerAgendados(supabase as never, user.id);
    await gravarAgendados(supabase as never, user.id, list.filter((a) => a.id !== id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
