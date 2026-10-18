import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { readAttentionSnapshot } from "@/lib/alerts/attention-snapshot";

// Contas que precisam de atenção (mesma lista do Resumo das 7h) — lido pelo Painel pra pôr o 🚨 e o filtro "Atenção". Só lê do banco.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json(await readAttentionSnapshot(supabase, user.id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
