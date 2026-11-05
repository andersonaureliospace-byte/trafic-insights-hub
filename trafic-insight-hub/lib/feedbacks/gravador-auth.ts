import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Etapa 249: as rotas /api/public/gravador/* são chamadas pela extensão do Chrome (sem login do Hub). Protegidas por
// uma chave: GRAVADOR_SECRET, ou, se ela não existir, o mesmo WHATSAPP_DISPATCH_SECRET que o n8n já usa.
// O Hub é de um usuário só, então o dono é o da instância de WhatsApp cadastrada.
export async function gravadorAuth(request: Request) {
  const secret = process.env.GRAVADOR_SECRET || process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return { error: NextResponse.json({ error: "GRAVADOR_SECRET não configurado no servidor." }, { status: 500 }) } as const;
  }
  if (request.headers.get("x-gravador-secret") !== secret) {
    return { error: NextResponse.json({ error: "Chave do gravador inválida." }, { status: 401 }) } as const;
  }
  const supabase = createServiceClient();
  const { data: inst } = await supabase.from("whatsapp_instances").select("user_id").order("is_primary", { ascending: false }).limit(1);
  let userId = (inst?.[0]?.user_id as string | undefined) ?? null;
  if (!userId) {
    const { data: b } = await supabase.from("account_bindings").select("user_id").limit(1);
    userId = (b?.[0]?.user_id as string | undefined) ?? null;
  }
  if (!userId) return { error: NextResponse.json({ error: "Nenhum usuário encontrado no Hub." }, { status: 500 }) } as const;
  return { supabase, userId } as const;
}
