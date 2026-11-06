import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { chainDisparos, runDisparos } from "@/lib/estrategia/disparos";

// Etapa 270: uma rodada dos Disparos em segundo plano. O próprio Hub chama este gancho em corrente (enquanto tiver fila);
// a batida das Auditorias e o Hub aberto reacendem se a corrente quebrar. Protegido pelo WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: ativos } = await db.from("estr_disparos").select("user_id").eq("status", "rodando").limit(50);
  const users = [...new Set((ativos ?? []).map((a) => a.user_id as string))];
  if (users.length === 0) return NextResponse.json({ ok: true, idle: true });

  const origin = new URL(request.url).origin;
  after(async () => {
    let pending = false;
    for (const u of users) {
      const r = await runDisparos(db, u).catch(() => ({ sent: 0, pending: true }));
      pending = pending || r.pending;
    }
    if (pending) await chainDisparos(origin);
  });
  return NextResponse.json({ ok: true, users: users.length });
}
