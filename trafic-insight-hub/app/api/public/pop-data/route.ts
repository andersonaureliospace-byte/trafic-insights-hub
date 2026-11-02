import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Etapa 241: dados do POP público de nomenclatura (/pop/nomenclatura), sem login:
//   units        = nomes das unidades (clientes IVS ativos), pra lista de pesquisa do "Monte o nome";
//   responsaveis = nome + identificação de cada gestor (sem WhatsApp).
// App de um usuário só: usa o dono das credenciais da Meta.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = createServiceClient();
    const { data: cred } = await db.from("user_meta_credentials").select("user_id").not("access_token", "is", null).limit(1);
    const userId = cred?.[0]?.user_id as string | undefined;
    if (!userId) return NextResponse.json({ units: [], responsaveis: [] });

    const [b, g] = await Promise.all([
      db.from("account_bindings").select("*").eq("user_id", userId),
      db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", "gestores").maybeSingle(),
    ]);
    const units = [
      ...new Set(
        ((b.data ?? []) as Array<{ client_name?: string | null; active?: boolean; archived?: boolean }>)
          .filter((x) => x.active !== false && !x.archived)
          .map((x) => (x.client_name ?? "").trim().toUpperCase())
          .filter((n) => /\bIVS\b/.test(n)),
      ),
    ].sort((x, y) => x.localeCompare(y, "pt-BR"));
    const responsaveis = (Array.isArray(g.data?.pref_value) ? (g.data.pref_value as unknown[]) : [])
      .map((x) => (x && typeof x === "object" ? (x as { name?: unknown; tag?: unknown }) : { name: x }))
      .map((x) => ({ name: String(x.name ?? "").trim(), tag: String(x.tag ?? "").trim().toUpperCase() }))
      .filter((x) => x.name && x.tag);
    return NextResponse.json({ units, responsaveis }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return NextResponse.json({ units: [], responsaveis: [], error: (e as Error).message });
  }
}
