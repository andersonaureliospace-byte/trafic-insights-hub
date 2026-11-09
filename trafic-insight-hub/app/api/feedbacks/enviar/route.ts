import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { FEEDBACK_COLUMNS, sendFeedback, type FeedbackRow } from "@/lib/feedbacks/core";
import { calendarSP } from "@/lib/estrategia/calc";

// Etapa 249: botão "Enviar pro cliente" — manda o vídeo no grupo e, em seguida, o resumo numa mensagem separada.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { supabase, user } = await requireUser().catch(() => ({ supabase: null, user: null }));
  if (!supabase || !user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { id, proximo } = (await request.json().catch(() => ({}))) as { id?: string; proximo?: string };
  try {
    const { data, error } = await supabase.from("client_feedbacks").select(FEEDBACK_COLUMNS).eq("id", String(id)).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Feedback não encontrado.");
    const row = data as FeedbackRow;
    if (row.status === "enviando") throw new Error("O vídeo ainda não terminou de subir.");
    const inst = await requireWhatsappInstance(supabase, user.id);
    await sendFeedback(supabase, { api_url: inst.api_url, token: inst.token }, row);
    const now = new Date().toISOString();
    await supabase.from("client_feedbacks").update({ status: "enviado", sent_at: now, send_error: null, updated_at: now }).eq("id", row.id);
    // Etapa 291: feedback enviado → conclui a tarefa de feedback do cliente (de hoje ou atrasada) no quadro Demandas e,
    // se veio a data, já programa o próximo. Falha aqui não desfaz o envio.
    let tarefa: { concluidas: number; proximo: string | null } | null = null;
    try {
      tarefa = await fecharTarefaFeedback(supabase, user.id, row, proximo);
    } catch {
      /* sem a tabela de Demandas ainda */
    }
    return NextResponse.json({ ok: true, tarefa });
  } catch (e) {
    const msg = (e as Error).message;
    if (id) await supabase.from("client_feedbacks").update({ send_error: msg.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", String(id)).eq("user_id", user.id);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

async function fecharTarefaFeedback(
  supabase: NonNullable<Awaited<ReturnType<typeof requireUser>>["supabase"]>,
  userId: string,
  row: FeedbackRow,
  proximo: string | undefined,
): Promise<{ concluidas: number; proximo: string | null }> {
  const hoje = calendarSP().today;
  const acc = String(row.ad_account_id).replace(/^act_/, "");
  const now = new Date().toISOString();
  const { data: done } = await supabase
    .from("estr_tarefas")
    .update({ status: "feita", done_at: now, updated_at: now })
    .eq("user_id", userId)
    .eq("tipo", "feedback")
    .eq("status", "aberta")
    .in("ad_account_id", [acc, `act_${acc}`])
    .lte("data", hoje)
    .select("titulo, responsavel, client_name");
  let prox: string | null = null;
  if (proximo && /^\d{4}-\d{2}-\d{2}$/.test(proximo) && proximo > hoje) {
    // não duplica: se já existe um feedback aberto no futuro pra esse cliente, só move ele pra data escolhida
    const { data: futuro } = await supabase
      .from("estr_tarefas")
      .select("id")
      .eq("user_id", userId)
      .eq("tipo", "feedback")
      .eq("status", "aberta")
      .in("ad_account_id", [acc, `act_${acc}`])
      .gt("data", hoje)
      .limit(1);
    if (futuro?.length) await supabase.from("estr_tarefas").update({ data: proximo, updated_at: now }).eq("id", futuro[0].id);
    else {
      const { data: b } = await supabase.from("account_bindings").select("responsible").eq("user_id", userId).in("ad_account_id", [acc, `act_${acc}`]).limit(1);
      await supabase.from("estr_tarefas").insert({
        user_id: userId,
        titulo: done?.[0]?.titulo ?? "Feedback do cliente",
        tipo: "feedback",
        ad_account_id: acc,
        client_name: row.client_name,
        responsavel: done?.[0]?.responsavel ?? (b?.[0]?.responsible as string | null) ?? null,
        data: proximo,
        ordem: Date.now() / 1e6,
      });
    }
    prox = proximo;
  }
  return { concluidas: done?.length ?? 0, proximo: prox };
}
