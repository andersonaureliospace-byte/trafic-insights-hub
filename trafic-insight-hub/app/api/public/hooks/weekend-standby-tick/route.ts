import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runWeekendStandby } from "@/lib/alerts/weekend-standby";

// Endpoint público chamado pelo n8n sábado e domingo de madrugada (Etapa 158) — põe em standby (orçamento R$10) os conjuntos de bom
// desempenho ou com mais de 3 dias ativos. Fora de sábado/domingo não faz nada. Protegido pelo segredo dos outros hooks.
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
    .select("user_id, access_token")
    .not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const results: Array<{ userId: string; skipped?: string; put?: number; noCut?: number; errors?: number; more?: boolean; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await runWeekendStandby(supabase, userId, token, { send: true });
      results.push({ userId, skipped: r.skipped, put: r.put, noCut: r.noCut, errors: r.errors, more: r.more, ...(r.sendError ? { error: r.sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
