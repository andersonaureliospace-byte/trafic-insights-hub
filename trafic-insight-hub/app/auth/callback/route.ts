import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Recebe o link de e-mail (recuperação de senha, convite etc.), troca o
// código por uma sessão e redireciona pra rota final.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/painel";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
