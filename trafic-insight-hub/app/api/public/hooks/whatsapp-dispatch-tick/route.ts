import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendText, sendMedia, mediaTypeFromMime } from "@/lib/whatsapp/client";
import { nextOccurrence, interpolate, type DispatchTarget, type PixMessagePart, type Recurrence } from "@/lib/whatsapp/dispatch";
import { greetingNow } from "@/lib/whatsapp/pix-message";

// Endpoint público chamado pelo n8n (num intervalo curto, ex.: a cada
// minuto) pra efetivamente disparar as mensagens agendadas. Não depende de
// sessão — usa a service role key — por isso é protegido por um segredo
// compartilhado (WHATSAPP_DISPATCH_SECRET) enviado no header
// x-webhook-secret. Configure o mesmo valor no node HTTP Request do n8n.
//
// Portado do app anterior (whatsapp-dispatch-tick.ts), sem a camada de
// workspace: cada disparo já carrega o user_id, e a instância uazapi é lida
// direto de whatsapp_instances.
//
// Etapa 73: além do disparo de texto único (Mensagens > Envio, `message`),
// agora também processa disparos de PIX por WhatsApp — uma SEQUÊNCIA de
// partes (`parts`: saudação + texto fixo + texto do pix + imagem) mandada em
// ordem pra cada target. Um disparo tem `message` OU `parts` preenchido,
// nunca os dois; `parts` tem prioridade quando presente.

interface DispatchRow {
  id: string;
  user_id: string;
  message: string | null;
  parts: PixMessagePart[] | null;
  targets: DispatchTarget[];
  scheduled_at: string;
  recurrence: Recurrence;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: claimed, error: claimErr } = await supabase
    .from("whatsapp_scheduled_dispatches")
    .update({ status: "running" })
    .lte("scheduled_at", nowIso)
    .eq("status", "pending")
    .select("id, user_id, message, parts, targets, scheduled_at, recurrence");
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const dispatches = (claimed ?? []) as DispatchRow[];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const d of dispatches) {
    const startedAt = new Date().toISOString();
    let successCount = 0;
    let errorCount = 0;
    let runError: string | null = null;

    try {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("api_url, token")
        .eq("user_id", d.user_id)
        .maybeSingle();
      const apiUrl = (inst?.api_url ?? "").trim().replace(/\/+$/, "");
      const token = (inst?.token ?? "").trim();
      if (!apiUrl || !token) throw new Error("WhatsApp não configurado para este usuário.");

      for (let i = 0; i < d.targets.length; i++) {
        const t = d.targets[i];
        try {
          if (d.parts && d.parts.length > 0) {
            // Etapa 73: sequência de partes (PIX) — manda cada uma em ordem,
            // com uma pausa curta entre elas (mensagens do mesmo "pacote",
            // não precisa do intervalo anti-spam de 30-60s usado entre
            // targets diferentes abaixo).
            for (let p = 0; p < d.parts.length; p++) {
              const part = d.parts[p];
              if (part.type === "greeting") {
                await sendText({ api_url: apiUrl, token }, t.wa_group_id, greetingNow());
              } else if (part.type === "text") {
                await sendText({ api_url: apiUrl, token }, t.wa_group_id, part.text);
              } else {
                await sendMedia({ api_url: apiUrl, token }, t.wa_group_id, {
                  url: part.url,
                  type: mediaTypeFromMime(part.mime),
                  fileName: part.fileName,
                });
              }
              if (p < d.parts.length - 1) await sleep(1_500);
            }
          } else {
            const msg = interpolate(d.message ?? "", t.client_name);
            await sendText({ api_url: apiUrl, token }, t.wa_group_id, msg);
          }
          successCount++;
        } catch (e) {
          errorCount++;
          runError = e instanceof Error ? e.message : String(e);
        }
        if (i < d.targets.length - 1) {
          // Espaça os envios (30-60s) pra não levar o número a um bloqueio por spam.
          await sleep(30_000 + Math.floor(Math.random() * 30_000));
        }
      }
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
      errorCount = d.targets.length;
    }

    await supabase.from("whatsapp_scheduled_dispatch_runs").insert({
      dispatch_id: d.id,
      status: errorCount === 0 ? "ok" : successCount > 0 ? "partial" : "error",
      detail: { started_at: startedAt, finished_at: new Date().toISOString(), successCount, errorCount, error: runError },
    });

    const next = nextOccurrence(new Date(d.scheduled_at), d.recurrence);
    const update: { last_run_at: string; last_error: string | null; status?: string; scheduled_at?: string } = {
      last_run_at: new Date().toISOString(),
      last_error: runError,
    };
    if (next) {
      update.status = "pending";
      update.scheduled_at = next.toISOString();
    } else {
      update.status = errorCount > 0 && successCount === 0 ? "error" : "done";
    }
    await supabase.from("whatsapp_scheduled_dispatches").update(update).eq("id", d.id);

    // Etapa 73: disparo de PIX agendado — atualiza o histórico (pix_sends)
    // com o resultado. Não faz nada quando não é um disparo de PIX (nenhuma
    // linha em pix_sends aponta pra esse dispatch_id).
    if (d.parts && d.parts.length > 0) {
      await supabase
        .from("pix_sends")
        .update({ status: errorCount === 0 ? "sent" : "error", error: runError })
        .eq("dispatch_id", d.id);
    }

    results.push({ id: d.id, ok: errorCount === 0 });
  }

  return NextResponse.json({ processed: dispatches.length, results });
}
