import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncDescriptionsFromAsana } from "@/lib/asana/descriptions";

// Etapa 115: endpoint público chamado pelo n8n a cada 30 minutos em horário comercial (seg-sex,
// 08h-18h). Traz a descrição das tarefas do Asana pra aba "Descrição": igual = não faz nada;
// divergente = o Traffic passa a ter a do Asana (rascunhos não enviados são preservados).
// Protegido pelo mesmo segredo dos outros hooks (WHATSAPP_DISPATCH_SECRET).
// Pede o tempo máximo de função (lê a seção inteira no Asana).
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase
    .from("user_meta_credentials")
    .select("user_id")
    .not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const results: Array<{ userId: string; checked?: number; updated?: number; notFound?: number; ambiguous?: number; configured?: boolean; errors?: string[]; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    try {
      const s = await syncDescriptionsFromAsana(supabase, userId);
      results.push({ userId, configured: s.configured, checked: s.checked, updated: s.updated.length, notFound: s.notFound.length, ambiguous: s.ambiguous.length, ...(s.errors.length ? { errors: s.errors } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
