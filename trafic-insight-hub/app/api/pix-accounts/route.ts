import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { computeManualCheckNextAt, todaySP } from "@/lib/alerts/manual-check";

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
      "manual_check_mode",
      "manual_check_weekday",
      "manual_check_interval_days",
      "manual_check_repeat",
    ];
    for (const key of WHITELIST) {
      if (key in body) patch[key] = body[key];
    }

    // Etapa 63: toda vez que a rotina de verificação manual é criada ou
    // alterada (modo, dia da semana ou intervalo), recalcula
    // manual_check_next_at a partir de hoje — sem isso a conta configurada
    // nunca ficaria pendente sozinha. Desligar o modo (null) zera o próximo
    // lembrete junto.
    const touchesSchedule =
      "manual_check_mode" in body || "manual_check_weekday" in body || "manual_check_interval_days" in body;
    if (touchesSchedule) {
      const { data: current } = await supabase
        .from("pix_accounts")
        .select("manual_check_mode, manual_check_weekday, manual_check_interval_days")
        .eq("user_id", user.id)
        .eq("ad_account_id", ad_account_id)
        .maybeSingle();
      const mode = ("manual_check_mode" in body ? body.manual_check_mode : current?.manual_check_mode) ?? null;
      const weekday =
        ("manual_check_weekday" in body ? body.manual_check_weekday : current?.manual_check_weekday) ?? null;
      const intervalDays =
        ("manual_check_interval_days" in body
          ? body.manual_check_interval_days
          : current?.manual_check_interval_days) ?? null;
      patch.manual_check_next_at =
        mode == null ? null : computeManualCheckNextAt({ mode, weekday, intervalDays }, todaySP(), true);
    }

    const { error } = await supabase.from("pix_accounts").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
