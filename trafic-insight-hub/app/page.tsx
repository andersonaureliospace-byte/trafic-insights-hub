import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Etapa 250: o app instalado (celular ou computador) abre em "/", e aqui decide a tela: no celular, as telas rápidas
// (/m); no computador, o Hub estratégico. Antes o atalho abria sempre /m, e o app instalado no PC caía na versão de celular.
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ua = (await headers()).get("user-agent") ?? "";
  redirect(MOBILE_UA.test(ua) ? "/m" : "/estrategia/trafego"); // Etapa 238: o Hub estratégico virou a tela inicial
}
