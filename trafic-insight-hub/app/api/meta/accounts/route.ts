import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { fetchAdAccounts, getAdAccounts } from "@/lib/meta/insights";

// ?fresh=1 (Etapa 254): pula o cache de 60s — botão "↻ Atualizar lista" do Novo cliente.
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const accounts = fresh ? await fetchAdAccounts(token) : await getAdAccounts(token);
    return NextResponse.json({ accounts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
