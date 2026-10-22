import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshVideoSnapshotForUser } from "@/lib/meta/video-snapshot";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 161: retrato dos vídeos de GERAL (Análise → Vídeos). n8n sugerido: 05h40 e repetir a cada 5 min por mais 3 vezes (cada chamada
// refaz as contas que ainda não são de hoje, até acabar o prazo da função). ?force=1 refaz todas. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("videos", async (request: Request) => {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase.from("user_meta_credentials").select("user_id, access_token").not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const deadline = Date.now() + 55_000;
  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await refreshVideoSnapshotForUser(supabase, cred.user_id as string, token, { force, deadlineMs: deadline });
      results.push({ userId: cred.user_id, ...r });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
