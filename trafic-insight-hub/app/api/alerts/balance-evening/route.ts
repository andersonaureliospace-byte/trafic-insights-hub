import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkEveningBalances } from "@/lib/alerts/balance-evening";

// Etapa 156: prévia do aviso das 19h pela sessão do usuário. GET = só mostra (texto simples, não envia nada);
// POST = monta e envia agora pro grupo + aba Alertas (igual ao hook das 19h).
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, text } = await checkEveningBalances(supabase, user.id, token, { send: false });
    const lines = statuses
      .sort((a, b) => a.projected - a.threshold - (b.projected - b.threshold))
      .map(
        (s) =>
          `${s.low ? (s.alreadyHandled ? "OK (Pix já enviado/programado)" : "AVISA") : "ok"} | ${s.client_name} | saldo ${s.balance.toFixed(2)} − ${s.spendSource === "ritmo" ? "Ritmo" : "orçamento"} ${s.spendTomorrow.toFixed(2)} = ${s.projected.toFixed(2)} | limite ${s.threshold.toFixed(2)}`,
      );
    return new Response(`${text || "Nenhuma conta para avisar agora."}\n\n--- todas as contas Pix/Híbrida ---\n${lines.join("\n")}\n`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { statuses, text, sendError } = await checkEveningBalances(supabase, user.id, token, { send: true });
    return NextResponse.json({ text, accounts: statuses.filter((s) => s.low && !s.alreadyHandled).length, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
