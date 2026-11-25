import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getMasterId } from "@/lib/master";

export const GRAVADOR_KEY_PREF = "gravador_key";

// Etapa 249: as rotas /api/public/gravador/* são chamadas pela extensão do Chrome (sem login do Hub). Protegidas por
// uma chave: GRAVADOR_SECRET, ou, se ela não existir, o mesmo WHATSAPP_DISPATCH_SECRET que o n8n já usa.
// O Hub é de um usuário só, então o dono é o da instância de WhatsApp cadastrada.
export async function gravadorAuth(request: Request) {
  const supabase = createServiceClient();
  const sent = request.headers.get("x-gravador-secret") ?? "";
  if (!sent) return { error: NextResponse.json({ error: "Chave do gravador inválida." }, { status: 401 }) } as const;

  // Etapa 353: chave PESSOAL do gravador (Configurações → Conexões → Gravador) → os feedbacks vão pra carteira de quem gravou.
  if (sent.startsWith("gk_")) {
    const { data } = await supabase.from("user_ui_prefs").select("user_id").eq("pref_key", GRAVADOR_KEY_PREF).eq("pref_value->>key", sent).limit(1);
    const uid = (data?.[0]?.user_id as string | undefined) ?? null;
    if (!uid) return { error: NextResponse.json({ error: "Chave do gravador inválida." }, { status: 401 }) } as const;
    return { supabase, userId: uid } as const;
  }

  // Chave antiga (GRAVADOR_SECRET / WHATSAPP_DISPATCH_SECRET) = carteira do master, como sempre foi.
  const secret = process.env.GRAVADOR_SECRET || process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return { error: NextResponse.json({ error: "GRAVADOR_SECRET não configurado no servidor." }, { status: 500 }) } as const;
  }
  if (sent !== secret) {
    return { error: NextResponse.json({ error: "Chave do gravador inválida." }, { status: 401 }) } as const;
  }
  let userId = await getMasterId(supabase);
  if (!userId) {
    const { data: inst } = await supabase.from("whatsapp_instances").select("user_id").order("is_primary", { ascending: false }).limit(1);
    userId = (inst?.[0]?.user_id as string | undefined) ?? null;
  }
  if (!userId) return { error: NextResponse.json({ error: "Nenhum usuário encontrado no Hub." }, { status: 500 }) } as const;
  return { supabase, userId } as const;
}
