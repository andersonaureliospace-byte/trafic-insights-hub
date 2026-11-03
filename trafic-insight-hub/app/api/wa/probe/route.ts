import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { listGroups, waFetch } from "@/lib/whatsapp/client";

// Etapa 244 (teste, só leitura): como a Uazapi devolve mensagens de um grupo, até quando vai o histórico e qual webhook
// já está configurado — pra montar o espelho do WhatsApp no Hub estratégico sem quebrar os avisos que já saem por ela.
export const maxDuration = 60;

function shape(v: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} itens)`] : [];
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = shape(x, depth + 1);
    return o;
  }
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  return v;
}

async function attempt(label: string, fn: () => Promise<unknown>) {
  try {
    return { label, ok: true, data: await fn() };
  } catch (e) {
    return { label, ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const creds = { api_url: inst.api_url, token: inst.token };
    const url = new URL(request.url);
    const groups = await listGroups(creds).catch(() => []);
    const chatid = url.searchParams.get("chat") || inst.alerts_group_id || groups[0]?.id || "";
    const out = [] as unknown[];
    out.push({ label: "groups", ok: true, data: { total: groups.length, sample: groups.slice(0, 3) } });
    out.push(await attempt("webhook GET", async () => shape(await waFetch(creds, "/webhook", { method: "GET" }))));
    const find = await attempt("message/find", async () => waFetch(creds, "/message/find", { method: "POST", body: JSON.stringify({ chatid, limit: 5 }) }));
    out.push({ ...find, data: find.ok ? shape(find.data) : undefined });
    // Mensagem mais antiga que a Uazapi tem desse grupo (paginando até 2000).
    out.push(
      await attempt("oldest", async () => {
        let offset = 0;
        let oldest: unknown = null;
        let total = 0;
        for (let i = 0; i < 10; i++) {
          const j = (await waFetch<Record<string, unknown>>(creds, "/message/find", {
            method: "POST",
            body: JSON.stringify({ chatid, limit: 200, offset }),
          })) as Record<string, unknown>;
          const arr = (Array.isArray(j) ? j : (j.messages as unknown[]) ?? (j.data as unknown[]) ?? []) as Array<Record<string, unknown>>;
          total += arr.length;
          if (arr.length) oldest = arr[arr.length - 1];
          if (arr.length < 200) break;
          offset += 200;
        }
        const o = (oldest ?? {}) as Record<string, unknown>;
        return { total, oldestTs: o.messageTimestamp ?? o.timestamp ?? o.t ?? null, keys: Object.keys(o) };
      }),
    );
    out.push(await attempt("chat/find", async () => shape(await waFetch(creds, "/chat/find", { method: "POST", body: JSON.stringify({ wa_isGroup: true, limit: 2 }) }))));
    return NextResponse.json({ chatid, out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
