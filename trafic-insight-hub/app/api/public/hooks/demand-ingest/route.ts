import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/gemini";
import { parseRequestText } from "@/lib/demands/parse-request";
import { matchClient } from "@/lib/demands/match-client";

// Endpoint público chamado pelo n8n (Etapa 68) — o workflow escuta o grupo
// dedicado de Demandas no WhatsApp, junta as mensagens de um mesmo remetente
// que chegam em sequência (~15s de silêncio fecha o pacote) e manda pra cá:
// todas as mensagens da SOLICITAÇÃO (pode ser mais de uma, texto e/ou áudio)
// mais a ÚLTIMA mensagem separada, que é sempre o nome do cliente digitado à
// mão. Esse hook usa IA (Gemini) em duas etapas, ambas travadas por prompt
// pra nunca interpretar/resumir/inventar (ver lib/ai/gemini.ts): (1)
// transcreve qualquer áudio literalmente; (2) separa o texto (que pode trazer
// vários pedidos misturados, sem Enter nem lista — comum em áudio) em itens,
// mantendo cada um exatamente como foi escrito/falado. Se a IA falhar,
// lib/demands/parse-request.ts cai num split determinístico por linha/lista
// como rede de segurança, pra nunca perder a solicitação.
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const groupId = String(body.groupId ?? "").trim();
    // Etapa 68 (ajuste): o nome do cliente é esperado como a última mensagem
    // do pacote, mas pode não vir (a pessoa esqueceu de mandar, por exemplo).
    // Nesse caso a demanda entra sem cliente vinculado — fica "em aberto" — e
    // dá pra atribuir manualmente depois na aba Demandas (PATCH em
    // /api/demands/[id]). Nunca bloqueia a criação da tarefa por causa disso.
    const clientNameRaw = String(body.clientNameRaw ?? "").trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!groupId) throw new Error("groupId é obrigatório.");
    if (messages.length === 0) throw new Error("messages é obrigatório (pelo menos 1 mensagem da solicitação).");

    const supabase = createServiceClient();

    const { data: instance, error: instanceErr } = await supabase
      .from("whatsapp_instances")
      .select("user_id, demands_group_id")
      .eq("demands_group_id", groupId)
      .maybeSingle();
    if (instanceErr) throw instanceErr;
    if (!instance) {
      throw new Error("Nenhum usuário tem esse grupo configurado como grupo de Demandas (Configurações → WhatsApp).");
    }
    const userId = instance.user_id as string;

    const texts: string[] = [];
    for (const m of messages) {
      const type = String(m?.type ?? "text");
      if (type === "audio") {
        const mediaUrl = String(m?.mediaUrl ?? "");
        if (!mediaUrl) throw new Error("Mensagem de áudio sem mediaUrl.");
        texts.push(await transcribeAudio(mediaUrl, String(m?.mimeType ?? "audio/ogg")));
      } else {
        const text = String(m?.text ?? "").trim();
        if (text) texts.push(text);
      }
    }
    if (texts.length === 0) throw new Error("Nenhum texto/áudio válido nas mensagens recebidas.");

    const { title, items } = await parseRequestText(texts);
    if (!title) throw new Error("Não deu pra extrair nenhuma tarefa das mensagens recebidas.");

    const { data: bindings } = await supabase
      .from("account_bindings")
      .select("ad_account_id, client_name")
      .eq("user_id", userId)
      .not("client_name", "is", null);
    const candidates = (bindings ?? [])
      .filter((b) => (b.client_name as string)?.trim())
      .map((b) => ({ ad_account_id: b.ad_account_id as string, client_name: b.client_name as string }));
    const matched = clientNameRaw ? matchClient(clientNameRaw, candidates) : null;

    const requestedAt = body.requestedAt ? new Date(body.requestedAt).toISOString() : new Date().toISOString();

    const { data: inserted, error: insertErr } = await supabase
      .from("demands")
      .insert({
        user_id: userId,
        ad_account_id: matched?.ad_account_id ?? null,
        client_name: matched?.client_name ?? null,
        client_name_raw: clientNameRaw,
        title,
        items,
        source_text: texts.join("\n"),
        requested_at: requestedAt,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true, id: inserted.id, matchedClient: matched?.client_name ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
