import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";

// Etapa 239 (Hub estratégico → Configurações → Gestores): responsável em massa.
//   { accountIds: [...], responsible: "Nome" | null } → coloca (ou tira) o responsável dessas contas;
//   { renameFrom: "Antigo", responsible: "Novo" | null } → troca o nome em todas as contas desse gestor
//     (usado ao renomear ou excluir um gestor; null = as contas ficam sem responsável).
// Só mexe na coluna responsible de account_bindings.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { accountIds?: unknown; responsible?: unknown; renameFrom?: unknown };
    const responsible = typeof body.responsible === "string" && body.responsible.trim() ? body.responsible.trim() : null;
    const now = new Date().toISOString();

    if (typeof body.renameFrom === "string" && body.renameFrom.trim()) {
      const { data, error } = await supabase
        .from("account_bindings")
        .update({ responsible, updated_at: now })
        .eq("user_id", user.id)
        .eq("responsible", body.renameFrom.trim())
        .select("ad_account_id");
      if (error) throw error;
      // Etapa 354: o acesso do gestor acompanha — renomeou: o login passa a valer pro nome novo;
      // excluiu o gestor: o login dele é apagado (não entra mais).
      try {
        const db = createServiceClient();
        const { data: logins } = await db
          .from("hub_members")
          .select("user_id")
          .eq("owner_id", user.id)
          .eq("role", "gestor")
          .ilike("display_name", body.renameFrom.trim());
        for (const l of logins ?? []) {
          if (responsible) await db.from("hub_members").update({ display_name: responsible }).eq("user_id", l.user_id);
          else await db.auth.admin.deleteUser(l.user_id as string);
        }
      } catch (e) {
        console.error("assign: acesso do gestor", (e as Error).message);
      }
      return NextResponse.json({ updated: (data ?? []).length });
    }

    const raw = Array.isArray(body.accountIds) ? body.accountIds.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    if (raw.length === 0) throw new Error("Escolha pelo menos uma conta.");
    // As contas podem estar gravadas com ou sem "act_": tenta as duas formas.
    const ids = [...new Set(raw.flatMap((id) => [id.replace(/^act_/, ""), `act_${id.replace(/^act_/, "")}`]))];
    const { data, error } = await supabase
      .from("account_bindings")
      .update({ responsible, updated_at: now })
      .eq("user_id", user.id)
      .in("ad_account_id", ids)
      .select("ad_account_id");
    if (error) {
      if (/responsible/.test(error.message)) {
        throw new Error("Rode o SQL supabase/migrations/0041_hub_estrategico.sql no Supabase pra ativar o responsável.");
      }
      throw error;
    }
    return NextResponse.json({ updated: (data ?? []).length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
