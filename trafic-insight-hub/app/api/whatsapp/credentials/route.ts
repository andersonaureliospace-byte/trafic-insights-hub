import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("api_url, token, status, alerts_group_id, alerts_group_name")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({
      api_url: data?.api_url ?? "",
      token: data?.token ?? "",
      status: data?.status ?? "disconnected",
      alerts_group_id: data?.alerts_group_id ?? null,
      alerts_group_name: data?.alerts_group_name ?? null,
      configured: !!(data?.api_url && data?.token),
    });
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const api_url = String(body.api_url ?? "").trim().replace(/\/+$/, "");
    const token = String(body.token ?? "").trim();
    if (!api_url || !token) throw new Error("Preencha a URL da API e o token.");

    const { error } = await supabase
      .from("whatsapp_instances")
      .upsert(
        { user_id: user.id, api_url, token, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
