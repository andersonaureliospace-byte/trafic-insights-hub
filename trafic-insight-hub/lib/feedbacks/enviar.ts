import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { FEEDBACK_COLUMNS, sendFeedback, type FeedbackRow } from "@/lib/feedbacks/core";
import { calendarSP } from "@/lib/estrategia/calc";

// Etapa 315: envio do feedback (prints/vídeo + mensagem) num lugar só — usado pelo botão "Enviar pro grupo" e pelo envio
// programado (estr-tick). Conclui a tarefa de feedback do cliente em Demandas e, se veio a data, programa o próximo.
export async function enviarFeedback(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  proximo?: string | null,
): Promise<{ concluidas: number; proximo: string | null } | null> {
  try {
    const { data, error } = await supabase.from("client_feedbacks").select(FEEDBACK_COLUMNS).eq("id", String(id)).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Feedback não encontrado.");
    const row = data as FeedbackRow;
    if (row.status === "enviando") throw new Error("O vídeo ainda não terminou de subir.");
    if (row.status === "enviado") return null; // já foi (ex.: enviado na mão antes do horário programado)
    const inst = await requireWhatsappInstance(supabase as never, userId);
    await sendFeedback(supabase, { api_url: inst.api_url, token: inst.token }, row);
    const now = new Date().toISOString();
    await supabase.from("client_feedbacks").update({ status: "enviado", sent_at: now, send_error: null, updated_at: now }).eq("id", row.id);
    try {
      return await fecharTarefaFeedback(supabase, userId, row, proximo ?? undefined);
    } catch {
      return null; // sem a tabela de Demandas ainda
    }
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("client_feedbacks").update({ send_error: msg.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", String(id)).eq("user_id", userId);
    throw e;
  }
}

async function fecharTarefaFeedback(
  supabase: SupabaseClient,
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
