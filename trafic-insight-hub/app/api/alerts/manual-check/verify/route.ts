import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { computeManualCheckNextAt, todaySP } from "@/lib/alerts/manual-check";

// "Marcar como verificado" — some da lista de pendentes até o próximo
// lembrete. Se manual_check_repeat estiver ligado, já recalcula a próxima
// data (mesmo dia da semana, ou +X dias de novo, a partir de hoje); se
// estiver desligado ("Pausar"), zera manual_check_next_at — a rotina fica
// dormente, com a configuração (dia/intervalo) preservada, até o usuário
// ligar "Repetir" de novo em Personalizar alertas.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const { data: pix, error: pixErr } = await supabase
      .from("pix_accounts")
      .select("manual_check_mode, manual_check_weekdays, manual_check_interval_days, manual_check_repeat")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .maybeSingle();
    if (pixErr) throw pixErr;
    if (!pix || !pix.manual_check_mode) throw new Error("Conta sem verificação manual configurada.");

    const nextAt = pix.manual_check_repeat
      ? computeManualCheckNextAt(
          {
            mode: pix.manual_check_mode as "weekday" | "interval",
            weekdays: pix.manual_check_weekdays,
            intervalDays: pix.manual_check_interval_days,
          },
          todaySP(),
          false,
        )
      : null;

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("pix_accounts")
      .update({
        manual_check_last_verified_at: now,
        manual_check_next_at: nextAt,
        manual_check_alert_sent_at: null,
      })
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id);
    if (error) throw error;

    return NextResponse.json({ ok: true, next_at: nextAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
