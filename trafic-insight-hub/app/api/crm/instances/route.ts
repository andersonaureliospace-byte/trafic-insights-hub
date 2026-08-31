import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data: instances, error } = await supabase
      .from("crm_instances")
      .select("id, name, public_token, sale_webhook_url, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const ids = (instances ?? []).map((i) => i.id as string);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: leads, error: leadsErr } = await supabase
        .from("crm_leads")
        .select("crm_instance_id")
        .in("crm_instance_id", ids);
      if (leadsErr) throw leadsErr;
      for (const l of leads ?? []) {
        const id = l.crm_instance_id as string;
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      instances: (instances ?? []).map((i) => ({ ...i, lead_count: counts[i.id as string] ?? 0 })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("Nome é obrigatório.");

    const { data, error } = await supabase
      .from("crm_instances")
      .insert({ user_id: user.id, name })
      .select("id, name, public_token, sale_webhook_url, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ instance: { ...data, lead_count: 0 } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
