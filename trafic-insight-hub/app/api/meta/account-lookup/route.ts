import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";
import type { AdAccount } from "@/lib/meta/insights";

// Etapa 254: "Verificar pelo ID" no Novo cliente — pergunta direto pra Meta se o token do Hub enxerga essa conta,
// mesmo que ela não venha na listagem. Se não enxergar, devolve o motivo em português.
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const raw = (new URL(request.url).searchParams.get("id") ?? "").replace(/\D/g, "");
    if (raw.length < 6) throw new Error("Digite o ID da conta (só os números, sem act_).");
    try {
      const a = await metaGet<AdAccount>(token, `/act_${raw}`, {
        fields: "id,account_id,name,account_status,disable_reason,balance,currency,amount_spent,spend_cap,business{id,name}",
      });
      return NextResponse.json({ account: a });
    } catch (e) {
      const msg = (e as Error).message;
      let motivo = "A Meta não deixou o Hub acessar essa conta.";
      if (/\(#?100\)|does not exist|nonexisting|Unsupported get request/i.test(msg)) {
        motivo = `A Meta diz que a conta ${raw} não existe ou que o seu usuário não tem acesso a ela.`;
      } else if (/\(#?(10|200|190)\)|permission|access token/i.test(msg)) {
        motivo = `Seu usuário não tem permissão nessa conta (${raw}).`;
      }
      return NextResponse.json({ error: `${motivo} Peça pro dono do Business liberar a conta pro seu usuário (ou pra sua BM e você dentro dela) e tente de novo.`, detalhe: msg.slice(0, 300) }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
