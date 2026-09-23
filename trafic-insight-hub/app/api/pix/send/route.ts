import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText, sendMedia, mediaTypeFromMime } from "@/lib/whatsapp/client";
import { buildPixParts, greetingNow, PIX_FIXED_TEXT } from "@/lib/whatsapp/pix-message";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Etapa 73: envio de PIX por WhatsApp direto do botão "Enviar Pix" em
// Controle de Saldo — 4 mensagens em sequência (saudação, texto fixo, texto
// do pix, print) pro destino já configurado em Personalizar Alertas (grupo
// do cliente ou número fixo, ver pix_accounts.pix_target_type). Sem
// schedule_at manda agora; com schedule_at, agenda reaproveitando
// whatsapp_scheduled_dispatches + o hook que já existe (whatsapp-dispatch-tick).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    const pix_text = String(body.pix_text ?? "").trim();
    const image = body.image as { url?: string; mime?: string; fileName?: string } | undefined;
    const schedule_at = body.schedule_at ? String(body.schedule_at) : "";

    if (!ad_account_id) throw new Error("Conta obrigatória.");
    if (!pix_text) throw new Error("Cole o texto do Pix (copia e cola).");
    if (!image?.url || !image?.mime) throw new Error("Envie o print do Pix.");

    const { data: binding } = await supabase
      .from("account_bindings")
      .select("client_name, wa_group_id, wa_group_name")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .maybeSingle();
    const client_name = ((binding?.client_name as string | null) ?? "").trim() || "Cliente";

    const { data: pixAccount } = await supabase
      .from("pix_accounts")
      .select("pix_target_type, pix_target_number")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .maybeSingle();
    const targetType = (pixAccount?.pix_target_type as "grupo" | "numero" | null) ?? "grupo";

    let target: string;
    let targetLabel: string;
    if (targetType === "numero") {
      target = ((pixAccount?.pix_target_number as string | null) ?? "").trim();
      if (!target) throw new Error("Configure o número de destino do Pix em Personalizar alertas.");
      targetLabel = target;
    } else {
      target = ((binding?.wa_group_id as string | null) ?? "").trim();
      if (!target) {
        throw new Error(
          "Esse cliente não tem grupo de WhatsApp vinculado (Painel → Clientes) — vincule um grupo ou configure um número em Personalizar alertas.",
        );
      }
      targetLabel = ((binding?.wa_group_name as string | null) ?? "").trim() || target;
    }

    const parts = buildPixParts(pix_text, { url: image.url, mime: image.mime, fileName: image.fileName });

    if (!schedule_at) {
      // Envio imediato: manda a sequência agora mesmo (saudação já resolvida
      // pelo horário atual) e grava o resultado direto no histórico.
      const inst = await requireWhatsappInstance(supabase, user.id);
      const creds = { api_url: inst.api_url, token: inst.token };

      const { data: record, error: insertError } = await supabase
        .from("pix_sends")
        .insert({
          user_id: user.id,
          ad_account_id,
          client_name,
          target_type: targetType,
          target_label: targetLabel,
          pix_text,
          image_url: image.url,
          image_file_name: image.fileName ?? "",
          status: "pending",
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      let errMsg: string | null = null;
      try {
        await sendText(creds, target, greetingNow());
        await sleep(1_500);
        await sendText(creds, target, PIX_FIXED_TEXT);
        await sleep(1_500);
        await sendText(creds, target, pix_text);
        await sleep(1_500);
        await sendMedia(creds, target, {
          url: image.url,
          type: mediaTypeFromMime(image.mime),
          fileName: image.fileName,
        });
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      }

      await supabase
        .from("pix_sends")
        .update({ status: errMsg ? "error" : "sent", error: errMsg })
        .eq("id", record.id);
      if (errMsg) throw new Error(errMsg);

      return NextResponse.json({ ok: true });
    }

    // Agendado: insere no mesmo sistema de agendamento de Mensagens > Envio
    // (parts em vez de message), o hook whatsapp-dispatch-tick já processa.
    const scheduledDate = new Date(schedule_at);
    if (Number.isNaN(scheduledDate.getTime())) throw new Error("Data de agendamento inválida.");

    const { data: dispatch, error: dispatchError } = await supabase
      .from("whatsapp_scheduled_dispatches")
      .insert({
        user_id: user.id,
        message: null,
        parts,
        targets: [{ ad_account_id, client_name, wa_group_id: target, wa_group_name: targetLabel }],
        scheduled_at: scheduledDate.toISOString(),
        recurrence: "none",
        status: "pending",
      })
      .select("id")
      .single();
    if (dispatchError) throw dispatchError;

    const { error: sendError } = await supabase.from("pix_sends").insert({
      user_id: user.id,
      ad_account_id,
      client_name,
      target_type: targetType,
      target_label: targetLabel,
      pix_text,
      image_url: image.url,
      image_file_name: image.fileName ?? "",
      scheduled_at: scheduledDate.toISOString(),
      dispatch_id: dispatch.id,
      status: "scheduled",
    });
    if (sendError) throw sendError;

    return NextResponse.json({ ok: true, scheduled: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
