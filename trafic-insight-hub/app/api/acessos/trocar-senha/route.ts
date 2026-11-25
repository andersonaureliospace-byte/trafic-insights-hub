import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Etapa 351: troca da senha provisória no primeiro acesso (e troca voluntária). Depois de trocar, libera o Hub.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Faça login de novo." }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    const password = String(body.password ?? "");
    if (password.length < 8) return NextResponse.json({ error: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const msg = /different|same/i.test(error.message) ? "A nova senha precisa ser diferente da provisória." : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const db = createServiceClient();
    await db.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata ?? {}), must_change_password: false },
    });
    await db.from("hub_members").update({ must_change_password: false }).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
