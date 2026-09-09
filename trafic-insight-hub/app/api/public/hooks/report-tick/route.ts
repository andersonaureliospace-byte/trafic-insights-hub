import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { buildReportMessage } from "@/lib/reports/generate";
import { nextOccurrence, type Recurrence } from "@/lib/scheduling";
import type { DatePreset } from "@/lib/meta/client";

// Endpoint público chamado pelo n8n (ex.: a cada 15-30 minutos) pra
// efetivamente disparar os relatórios agendados de Mensagens > Relatórios.
// Mesmo padrão dos outros hooks: protegido pelo WHATSAPP_DISPATCH_SECRET,
// usa a service role (sem sessão de usuário).
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error: dueErr } = await supabase
    .from("scheduled_reports")
    .select("id, user_id, template_id, ad_account_ids, wa_group_id, wa_group_name, recurrence, next_run_at")
    .eq("paused", false)
    .lte("next_run_at", nowIso);
  if (dueErr) return NextResponse.json({ error: dueErr.message }, { status: 500 });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const report of due ?? []) {
    let runError: string | null = null;
    try {
      const { data: template, error: templErr } = await supabase
        .from("report_templates")
        .select("body, period_preset")
        .eq("id", report.template_id)
        .maybeSingle();
      if (templErr) throw templErr;
      if (!template) throw new Error("Modelo de relatório não encontrado (foi excluído?).");

      const { data: cred } = await supabase
        .from("user_meta_credentials")
        .select("access_token")
        .eq("user_id", report.user_id)
        .maybeSingle();
      const token = cred?.access_token as string | undefined;
      if (!token) throw new Error("Token Meta não configurado.");

      const accountIds = (report.ad_account_ids ?? []) as string[];
      const { data: bindings } = await supabase
        .from("account_bindings")
        .select("ad_account_id, client_name, cpa_target, monthly_investment")
        .eq("user_id", report.user_id)
        .in("ad_account_id", accountIds);
      const bindingById = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));
      const accounts = accountIds.map((id) => {
        const b = bindingById.get(id);
        return {
          ad_account_id: id,
          client_name: (b?.client_name as string) || id,
          cpa_target: (b?.cpa_target as number | null) ?? null,
          monthly_investment: (b?.monthly_investment as number | null) ?? null,
        };
      });

      const message = await buildReportMessage(token, template.body, template.period_preset as DatePreset, accounts);

      const instance = await requireWhatsappInstance(supabase, report.user_id);
      await sendText({ api_url: instance.api_url, token: instance.token }, report.wa_group_id, message);
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
    }

    await supabase.from("scheduled_report_runs").insert({
      scheduled_report_id: report.id,
      status: runError ? "error" : "ok",
      detail: { error: runError },
    });

    const next = nextOccurrence(new Date(report.next_run_at), report.recurrence as Recurrence);
    await supabase
      .from("scheduled_reports")
      .update({ next_run_at: (next ?? new Date()).toISOString() })
      .eq("id", report.id);

    results.push({ id: report.id, ok: !runError, error: runError ?? undefined });
  }

  return NextResponse.json({ processed: (due ?? []).length, results });
}
