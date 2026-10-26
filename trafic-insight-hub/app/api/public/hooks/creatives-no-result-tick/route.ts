import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndPauseCreatives } from "@/lib/alerts/creatives-pause";
import { withRunLog } from "@/lib/automation-runs";

// Endpoint público (Etapa 124: SEM agendamento no n8n — criativos sem resultado já são pausados por
// creatives-pause-tick; a rota continua existindo pra uso manual) — pausa só os criativos
// ATIVOS SEM RESULTADO: gastaram R$4+ acima da Meta CPA ontem + hoje sem nenhuma conversa
// iniciada (mesmas regras de histórico dos 7 dias de creatives-pause-tick). Roda com mais
// frequência que creatives-pause-tick, que também pausa o criativo "ruim" (com conversa,
// mas caro) — esse ainda pode reverter, então é avaliado só de 3 em 3 horas. Avisa o grupo
// de WhatsApp configurado. Protegido pelo mesmo segredo compartilhado dos outros hooks
// internos (WHATSAPP_DISPATCH_SECRET).
// Varre muitas contas na Meta: pede o tempo máximo de função (evita corte silencioso).
export const maxDuration = 60;

export const POST = withRunLog("creatives-no-result", async (request: Request) => {
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

  const results: Array<{ userId: string; paused?: number; accounts?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { paused, sendError, diag } = await checkAndPauseCreatives(supabase, userId, token, { send: true, onlyNoResult: true });
      // Etapa 206: conta em que a busca na Meta falhou (mesmo tentando de novo) aparece como erro no Registro das automações.
      const failed = diag.filter((x) => x.error).map((x) => `${x.client_name}: ${x.error}`);
      const notPaused = paused.filter((p) => !p.ok).length;
      const errText = [sendError, failed.length ? `contas não verificadas — ${failed.join(" | ")}` : null, notPaused ? `${notPaused} criativo(s) não pausado(s) (erro ou falta de tempo)` : null].filter(Boolean).join(" · ");
      results.push({ userId, paused: paused.filter((p) => p.ok).length, accounts: diag.length, ...(errText ? { error: errText } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
