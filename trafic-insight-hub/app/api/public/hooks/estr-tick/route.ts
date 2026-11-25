import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runTick } from "@/lib/estrategia/auditorias/run";
import { jobsOfCheck, type CheckId } from "@/lib/estrategia/auditorias/config";
import { chainDisparos, hasStalledDisparo } from "@/lib/estrategia/disparos";
import { liberarDisparosAgendados } from "@/lib/estrategia/disparos-agendados";
import { enviarAgendados } from "@/lib/feedbacks/agendados";
import { listOwners } from "@/lib/master";
import { withAsanaFor } from "@/lib/asana/scope";

// Etapa 257: batida das Auditorias do Hub estratégico. O n8n chama a cada 15 min (fluxo "Auditorias — Hub estratégico");
// o Hub decide o que rodar pelo horário de Brasília (agenda em lib/estrategia/auditorias/config.ts). Protegido pelo
// mesmo WHATSAPP_DISPATCH_SECRET dos outros hooks.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createServiceClient();
  // Etapa 353: uma batida por estrategista (cada um com a carteira, o WhatsApp e os gestores dele).
  // O n8n chama sem corpo → roda o master aqui e dispara uma chamada separada pra cada outro estrategista
  // ({ userId }), pra cada um ter o próprio tempo de execução.
  const body = (await request.json().catch(() => ({}))) as { only?: string; userId?: string };
  const owners = await listOwners(db);
  let userId: string | null = null;
  if (typeof body.userId === "string") {
    if (!owners.includes(body.userId)) return NextResponse.json({ error: "Estrategista não encontrado." }, { status: 404 });
    userId = body.userId;
  } else {
    userId = owners[0] ?? null;
    if (!userId) {
      // antes de cadastrar o token da Meta: como era (dono da instância de WhatsApp)
      const { data: inst } = await db.from("whatsapp_instances").select("user_id").limit(1);
      userId = (inst?.[0]?.user_id as string | undefined) ?? null;
    }
    const outros = owners.slice(1);
    if (outros.length > 0) {
      const origin = new URL(request.url).origin;
      after(async () => {
        for (const id of outros) {
          await fetch(`${origin}/api/public/hooks/estr-tick`, {
            method: "POST",
            headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
            body: JSON.stringify({ userId: id, ...(body.only ? { only: body.only } : {}) }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
        }
      });
    }
  }
  if (!userId) return NextResponse.json({ error: "Nenhum usuário no Hub." }, { status: 500 });

  try {
    // Etapa 270: se um Disparo em segundo plano parou no meio (corrente quebrou), reacende.
    const origin = new URL(request.url).origin;
    after(async () => {
      // Etapa 346: disparos agendados que chegaram na hora
      const liberados = await liberarDisparosAgendados(db as never, userId as string).catch(() => 0);
      if (liberados > 0 || (await hasStalledDisparo(db, userId as string).catch(() => false))) await chainDisparos(origin);
      // Etapa 315: feedbacks com envio programado que já passaram do horário
      await enviarAgendados(db as never, userId as string).catch((e) => console.error("feedbacks agendados", (e as Error).message));
    });
    // Corpo opcional { "only": "prioridade" } roda só essa conferência agora, fora da agenda (refazer manual).
    // Sem corpo (o n8n a cada 15 min) continua igual: o Hub decide pelo horário.
    const only = typeof body.only === "string" && jobsOfCheck(body.only).length > 0 ? (body.only as CheckId) : undefined;
    const uid = userId;
    const report = await withAsanaFor(db, uid, () => runTick(db, uid, only ? { only } : {}));
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
