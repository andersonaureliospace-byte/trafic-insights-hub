// Etapa 68: lógica compartilhada de criação de demanda — extraída pra ser
// reaproveitada tanto pelo hook direto (demand-ingest, pacote já pronto)
// quanto pelo fluxo com buffer (demand-buffer-flush, que monta o pacote a
// partir das mensagens acumuladas de um remetente). Transcreve áudio
// literalmente, organiza o texto em título + itens (ver lib/demands/parse-request.ts)
// e tenta casar o nome do cliente com uma conta já cadastrada.
import { createServiceClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/gemini";
import { parseRequestText } from "@/lib/demands/parse-request";
import { matchClient } from "@/lib/demands/match-client";

export interface IngestMessage {
  type: "text" | "audio";
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
}

export interface IngestResult {
  id: string;
  matchedClient: string | null;
}

export async function resolveUserByDemandsGroup(groupId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("user_id")
    .eq("demands_group_id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Nenhum usuário tem esse grupo configurado como grupo de Demandas (Configurações → WhatsApp).");
  }
  return data.user_id as string;
}

export async function ingestDemand(params: {
  userId: string;
  clientNameRaw: string;
  messages: IngestMessage[];
  requestedAt?: string | null;
}): Promise<IngestResult> {
  const texts: string[] = [];
  for (const m of params.messages) {
    if (m.type === "audio") {
      if (!m.mediaUrl) throw new Error("Mensagem de áudio sem mediaUrl.");
      texts.push(await transcribeAudio(m.mediaUrl, m.mimeType ?? "audio/ogg"));
    } else {
      const t = (m.text ?? "").trim();
      if (t) texts.push(t);
    }
  }
  if (texts.length === 0) throw new Error("Nenhum texto/áudio válido nas mensagens recebidas.");

  const { title, items } = await parseRequestText(texts);
  if (!title) throw new Error("Não deu pra extrair nenhuma tarefa das mensagens recebidas.");

  const supabase = createServiceClient();
  const { data: bindings } = await supabase
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", params.userId)
    .not("client_name", "is", null);
  const candidates = (bindings ?? [])
    .filter((b) => (b.client_name as string)?.trim())
    .map((b) => ({ ad_account_id: b.ad_account_id as string, client_name: b.client_name as string }));
  const matched = params.clientNameRaw ? matchClient(params.clientNameRaw, candidates) : null;

  const requestedAt = params.requestedAt ? new Date(params.requestedAt).toISOString() : new Date().toISOString();

  const { data: inserted, error } = await supabase
    .from("demands")
    .insert({
      user_id: params.userId,
      ad_account_id: matched?.ad_account_id ?? null,
      client_name: matched?.client_name ?? null,
      client_name_raw: params.clientNameRaw,
      title,
      items,
      source_text: texts.join("\n"),
      requested_at: requestedAt,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: inserted.id as string, matchedClient: matched?.client_name ?? null };
}
