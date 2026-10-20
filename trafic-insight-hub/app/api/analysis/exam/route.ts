import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkExamAccounts, loadExamAccounts, readExamSnapshot } from "@/lib/exam/check";

// Etapa 163: Análise → Exame.
//  GET   → contas (com "precisa de exame?") + último retrato da verificação, sem consultar a Meta.
//  POST  → confere agora as contas pedidas (lotes pequenos, o servidor tem 60s) e guarda no retrato. Não envia alerta.
//  PATCH → muda "precisa de exame?" de uma conta (true/false; null volta ao padrão).
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [accounts, snapshot] = await Promise.all([loadExamAccounts(supabase, user.id), readExamSnapshot(supabase, user.id)]);
    return NextResponse.json({ accounts, statuses: snapshot.accounts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = await request.json();
    const wanted: string[] = Array.isArray(body.accountIds) ? (body.accountIds as string[]) : [];
    const allowed = new Set((await loadExamAccounts(supabase, user.id)).map((a) => a.accountId));
    const ids = wanted.filter((id) => allowed.has(id));
    if (ids.length === 0) return NextResponse.json({ statuses: [] });
    return NextResponse.json({ statuses: await checkExamAccounts(supabase, user.id, token, ids) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const accountId = String(body.accountId ?? "");
    const needsExam = body.needsExam === null ? null : body.needsExam === true ? true : body.needsExam === false ? false : undefined;
    if (!accountId || needsExam === undefined) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const { data, error } = await supabase
      .from("account_bindings")
      .update({ needs_exam: needsExam })
      .eq("user_id", user.id)
      .eq("ad_account_id", accountId)
      .select("ad_account_id");
    if (error) {
      const missingCol = /needs_exam/i.test(error.message);
      return NextResponse.json({ error: missingCol ? "Rode o SQL 0035_needs_exam.sql no Supabase para guardar essa escolha." : error.message }, { status: 400 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "Conta sem ficha em Clientes." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
