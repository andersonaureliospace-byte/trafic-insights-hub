import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runOffersTick } from "@/lib/offers/scan";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 149: retrato das "Ofertas ativas" (aba Descrição) — n8n sugerido: ~05h20 e ~12h00, repetindo a cada 6 min por mais
// 2 vezes (cada chamada só refaz as contas com retrato velho, até acabar o prazo da função). Lê os conjuntos do mês de cada
// conta IVS na Meta e grava em meta_insights_cache. ?force=1 refaz todas. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("offers", async (request: Request) => {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase.from("user_meta_credentials").select("user_id, access_token").not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const deadline = Date.now() + 50_000;
  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await runOffersTick(supabase, cred.user_id as string, token, { force, deadlineMs: deadline });
      results.push({ userId: cred.user_id, ...r });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
