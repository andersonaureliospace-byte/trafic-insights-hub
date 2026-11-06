import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runTick } from "@/lib/estrategia/auditorias/run";

// Etapa 257: batida das Auditorias do Hub estratégico. O n8n chama a cada 15 min (fluxo "Auditorias — Hub estratégico");
// o Hub decide o que rodar pelo horário de Brasília (agenda em lib/estrategia/auditorias/config.ts). Protegido pelo
// mesmo WHATSAPP_DISPATCH_SECRET dos outros hooks.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: inst } = await db.from("whatsapp_instances").select("user_id").limit(1);
  let userId = (inst?.[0]?.user_id as string | undefined) ?? null;
  if (!userId) {
    const { data: b } = await db.from("account_bindings").select("user_id").limit(1);
    userId = (b?.[0]?.user_id as string | undefined) ?? null;
  }
  if (!userId) return NextResponse.json({ error: "Nenhum usuário no Hub." }, { status: 500 });

  try {
    const report = await runTick(db, userId);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
