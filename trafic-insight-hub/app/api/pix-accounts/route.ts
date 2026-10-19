import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("pix_accounts").select("*").eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ pixAccounts: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const patch: Record<string, unknown> = { user_id: user.id, ad_account_id, updated_at: new Date().toISOString() };
    const WHITELIST = [
      "payment_type",
      "base_amount",
      "notes",
      "alert_threshold",
      "friday_multiplier",
      // Etapa 73: destino do envio de PIX por WhatsApp — configurado uma vez
      // aqui (raramente muda), ver supabase/migrations/0022_*.
      "pix_target_type",
      "pix_target_number",
      // Etapa 81: "Saldo por fundos" — independente do Tipo de conta (ver
      // supabase/migrations/0025_*). funds_balance_watermark só é escrito
      // pelo próprio app (nunca editado manualmente), sempre junto de
      // funds_balance_amount, pra resetar o ponto de partida do cálculo.
      "funds_balance_enabled",
      "funds_balance_amount",
      "funds_balance_currency",
      "funds_balance_watermark",
    ];
    for (const key of WHITELIST) {
      if (key in body) patch[key] = body[key];
    }

    const { error } = await supabase.from("pix_accounts").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
