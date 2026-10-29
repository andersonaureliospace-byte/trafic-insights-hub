import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 221: inscrição das notificações push do app no celular.
//   GET    → chave pública (o app precisa dela pra pedir a inscrição ao iPhone)
//   POST   → guarda a inscrição deste aparelho   { subscription }
//   DELETE → remove a inscrição deste aparelho   { endpoint }
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({ publicKey });
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Inscrição inválida.");
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      if (/push_subscriptions/.test(error.message)) {
        throw new Error("Rode o SQL supabase/migrations/0039_push_subscriptions.sql no Supabase pra ativar as notificações.");
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { endpoint?: string };
    if (body.endpoint) await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
