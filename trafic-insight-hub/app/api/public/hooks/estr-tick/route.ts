import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runTick, slotNow } from "@/lib/estrategia/auditorias/run";
import { autoFinalizarTarefas } from "@/lib/estrategia/alerta-tarefas-auto";
import { jobsOfCheck, type CheckId } from "@/lib/estrategia/auditorias/config";
import { chainDisparos, hasStalledDisparo } from "@/lib/estrategia/disparos";
import { enviarAgendados } from "@/lib/feedbacks/agendados";

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
    // Etapa 270: se um Disparo em segundo plano parou no meio (corrente quebrou), reacende.
    const origin = new URL(request.url).origin;
    after(async () => {
      if (await hasStalledDisparo(db, userId as string).catch(() => false)) await chainDisparos(origin);
      // Etapa 315: feedbacks com envio programado que já passaram do horário
      await enviarAgendados(db as never, userId as string).catch((e) => console.error("feedbacks agendados", (e as Error).message));
      // Etapa 341: tarefas do quadro Alertas — a cada 30 min, das 08h às 18h: fecha as de CPA quando o CPA de hoje caiu
      const sl = slotNow();
      if (sl >= 8 * 60 && sl <= 18 * 60 && sl % 30 === 0) {
        await autoFinalizarTarefas(db as never, userId as string).catch((e) => console.error("alerta-tarefas auto", (e as Error).message));
      }
    });
    // Corpo opcional { "only": "prioridade" } roda só essa conferência agora, fora da agenda (refazer manual).
    // Sem corpo (o n8n a cada 15 min) continua igual: o Hub decide pelo horário.
    const body = (await request.json().catch(() => ({}))) as { only?: string };
    const only = typeof body.only === "string" && jobsOfCheck(body.only).length > 0 ? (body.only as CheckId) : undefined;
    const report = await runTick(db, userId, only ? { only } : {});
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
