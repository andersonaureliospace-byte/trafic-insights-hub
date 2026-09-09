import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { runErrorAudit } from "@/lib/audit/run";
import type { createClient } from "@/lib/supabase/server";

interface Binding {
  ad_account_id: string;
  client_name: string | null;
}

interface ErrorStatusRow {
  ad_account_id: string;
  entity_type: "ad" | "adset";
  entity_id: string;
  entity_name: string | null;
  error_message: string;
  checked_at: string;
}

async function loadBindings(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<Binding[]> {
  const { data, error } = await supabase
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", userId);
  if (error) throw error;
  const list = (data ?? []) as Binding[];
  list.sort((a, b) => (a.client_name || a.ad_account_id).localeCompare(b.client_name || b.ad_account_id, "pt-BR"));
  return list;
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const bindings = await loadBindings(supabase, user.id);
    const { data, error } = await supabase
      .from("audit_error_status")
      .select("ad_account_id, entity_type, entity_id, entity_name, error_message, checked_at")
      .eq("user_id", user.id);
    if (error) throw error;

    const byAccount = new Map<string, ErrorStatusRow[]>();
    for (const r of (data ?? []) as ErrorStatusRow[]) {
      const arr = byAccount.get(r.ad_account_id) ?? [];
      arr.push(r);
      byAccount.set(r.ad_account_id, arr);
    }

    const rows = bindings.map((b) => {
      const accountRows = byAccount.get(b.ad_account_id) ?? [];
      const checkedAt = accountRows.reduce<string | null>(
        (acc, r) => (!acc || r.checked_at > acc ? r.checked_at : acc),
        null,
      );
      return {
        ad_account_id: b.ad_account_id,
        account_name: b.client_name || b.ad_account_id,
        status: accountRows.length > 0 ? "incorrect" : "correct",
        issues: accountRows.map((r) => ({
          entity_id: r.entity_id,
          entity_name: r.entity_name,
          entity_type: r.entity_type,
          reasons: r.error_message.split(" · "),
        })),
        checked_at: checkedAt,
      };
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const bindings = await loadBindings(supabase, user.id);
    if (bindings.length === 0) {
      return NextResponse.json({ rows: [], pausedCount: 0, failedCount: 0 });
    }

    const { byAccount, pausedCount, failedCount } = await runErrorAudit(supabase, user.id, token, bindings);
    const now = new Date().toISOString();
    const rows = bindings.map((b) => {
      const issues = byAccount[b.ad_account_id] ?? [];
      return {
        ad_account_id: b.ad_account_id,
        account_name: b.client_name || b.ad_account_id,
        status: issues.length > 0 ? "incorrect" : "correct",
        issues,
        checked_at: now,
      };
    });
    return NextResponse.json({ rows, pausedCount, failedCount });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
