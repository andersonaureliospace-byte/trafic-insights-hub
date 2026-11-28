import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { listOwners } from "@/lib/master";
import { automationPaused } from "@/lib/automation-switches";
import { exemplosDeCenarios, gerarRotinaClientes } from "@/lib/estrategia/rotina-clientes/gerar";
import { enviarRotinaClientes } from "@/lib/estrategia/rotina-clientes/enviar";

// Etapa 355: Rotina da manhã pros grupos dos clientes. O n8n chama (fluxo "Rotina da manhã — clientes"):
//   { "acao": "gerar" }  ~06h30 seg a sex → escolhe os cenários e deixa as mensagens programadas pras 7h50 (pré-aprovadas)
//   { "acao": "enviar" } 07h50 seg a sex → manda a fila em ordem; o que não couber continua numa nova chamada sozinha
// Cada estrategista com a carteira e o WhatsApp dele. Protegido pelo WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const body = (await request.json().catch(() => ({}))) as { acao?: string; userId?: string; diaSemana?: number; exemplos?: boolean };
  const db = createServiceClient();
  const owners = await listOwners(db);
  const alvo = typeof body.userId === "string" ? owners.filter((o) => o === body.userId) : owners;
  const origin = new URL(request.url).origin;

  try {
    if (body.acao === "gerar") {
      if (await automationPaused("rotina-clientes")) return NextResponse.json({ ok: true, paused: true });
      // um estrategista por chamada (a IA leva alguns segundos); os outros em chamadas separadas
      const [primeiro, ...outros] = alvo;
      if (!primeiro) return NextResponse.json({ ok: true, owners: 0 });
      if (!body.userId && outros.length) {
        after(async () => {
          for (const id of outros) {
            await fetch(`${origin}/api/public/hooks/rotina-clientes-tick`, {
              method: "POST",
              headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
              body: JSON.stringify({ acao: "gerar", userId: id }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        });
      }
      const r = await gerarRotinaClientes(db, primeiro);
      return NextResponse.json({ ok: true, userId: primeiro, ...r });
    }

    // Modo teste: { "acao": "simular", "diaSemana": 5 } → devolve as mensagens que sairiam, sem gravar nem enviar nada
    if (body.acao === "simular" && body.exemplos) {
      const ds = Number(body.diaSemana) >= 1 && Number(body.diaSemana) <= 5 ? Number(body.diaSemana) : 1;
      return NextResponse.json({ ok: true, simulacao: true, exemplos: await exemplosDeCenarios(ds) });
    }
    if (body.acao === "simular") {
      const id = alvo[0];
      if (!id) return NextResponse.json({ ok: true, owners: 0 });
      const r = await gerarRotinaClientes(db, id, { simular: true, diaSemana: Number(body.diaSemana) || undefined, avisar: false });
      return NextResponse.json({ ok: true, simulacao: true, userId: id, ...r });
    }

    if (body.acao === "enviar") {
      const resultados: Array<Record<string, unknown>> = [];
      const continuar: string[] = [];
      for (const id of alvo) {
        const r = await enviarRotinaClientes(db, id, { deadlineMs: started + 55_000 });
        resultados.push({ userId: id, ...r });
        if (r.restantes > 0) continuar.push(id);
        if (Date.now() > started + 45_000) break;
      }
      // o que sobrou continua numa nova chamada (uma por estrategista)
      const pendentes = [...new Set([...continuar, ...alvo.filter((id) => !resultados.some((x) => x.userId === id))])];
      if (pendentes.length) {
        after(async () => {
          for (const id of pendentes) {
            await fetch(`${origin}/api/public/hooks/rotina-clientes-tick`, {
              method: "POST",
              headers: { "x-webhook-secret": secret, "Content-Type": "application/json" },
              body: JSON.stringify({ acao: "enviar", userId: id }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        });
      }
      return NextResponse.json({ ok: true, resultados, continua: pendentes.length });
    }

    return NextResponse.json({ error: 'Informe { "acao": "gerar" } ou { "acao": "enviar" }.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
