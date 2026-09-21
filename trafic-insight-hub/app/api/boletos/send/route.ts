import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

const WEEKDAYS_PT = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];

function formatDueDate(iso: string): { weekday: string; ddmmyy: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const yy = String(y).slice(-2);
  return {
    weekday: WEEKDAYS_PT[date.getUTCDay()],
    ddmmyy: `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${yy}`,
  };
}

// Etapa 71: dispara o e-mail de cobrança de boleto pro financeiro. Texto e
// destinatário são fixos (pedido explícito do usuário) — só loja, data de
// vencimento e o PDF variam. O app não manda e-mail direto: grava um
// registro em boleto_sends (histórico) e faz um POST pro webhook do n8n
// (BOLETO_WEBHOOK_URL), que manda de verdade pelo nó nativo do Gmail. Mesmo
// padrão de "app empurra pro n8n" de lib/crm/sale-webhook.ts.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    const due_date = String(body.due_date ?? "").trim();
    const pdf_url = String(body.pdf_url ?? "").trim();
    const pdf_file_name = String(body.pdf_file_name ?? "").trim();
    let client_name = String(body.client_name ?? "").trim();
    if (!ad_account_id) throw new Error("Selecione um cliente.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new Error("Escolha a data de vencimento.");
    if (!pdf_url) throw new Error("Envie o boleto em PDF antes de disparar o e-mail.");

    if (!client_name) {
      const { data: binding } = await supabase
        .from("account_bindings")
        .select("client_name")
        .eq("user_id", user.id)
        .eq("ad_account_id", ad_account_id)
        .maybeSingle();
      client_name = ((binding?.client_name as string | null) ?? "").trim();
    }
    if (!client_name) throw new Error("Esse cliente não tem nome cadastrado ainda (Painel → Clientes).");

    const webhookUrl = process.env.BOLETO_WEBHOOK_URL;
    const financeEmail = process.env.BOLETO_FINANCE_EMAIL;
    if (!webhookUrl || !financeEmail) {
      throw new Error("Envio de boleto ainda não configurado no servidor (BOLETO_WEBHOOK_URL / BOLETO_FINANCE_EMAIL).");
    }

    const { weekday, ddmmyy } = formatDueDate(due_date);
    const subject = client_name;
    const message =
      `Solicito verificar a possibilidade do pagamento do boleto em anexo, ${client_name} até ${weekday} ${ddmmyy}. Obrigado!\n\n` +
      `Qualquer dúvida estou à disposição\n` +
      `Att: Anderson Aurelio - Gestor de tráfego da conta`;

    const { data: record, error: insertError } = await supabase
      .from("boleto_sends")
      .insert({ user_id: user.id, ad_account_id, client_name, due_date, pdf_url, pdf_file_name, status: "pending" })
      .select("*")
      .single();
    if (insertError) throw insertError;

    let ok = false;
    let errMsg: string | null = null;
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: financeEmail,
          subject,
          message,
          pdf_url,
          pdf_file_name: pdf_file_name || "boleto.pdf",
          client_name,
          due_date,
        }),
      });
      ok = res.ok;
      if (!ok) errMsg = `O n8n respondeu com erro (${res.status}).`;
    } catch (webhookErr) {
      errMsg = (webhookErr as Error).message;
    }

    await supabase.from("boleto_sends").update({ status: ok ? "sent" : "error", error: errMsg }).eq("id", record.id);
    if (!ok) {
      throw new Error(errMsg ?? "Falha ao disparar o e-mail (webhook do n8n). Confira BOLETO_WEBHOOK_URL e o workflow no n8n.");
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
