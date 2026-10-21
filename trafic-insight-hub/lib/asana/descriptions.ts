// Etapa 115: aba "Descrição". Espelha a descrição (notes) da tarefa de cada cliente do Asana
// (seção "Anderson - (Denner)") dentro do Traffic e permite devolver o texto editado, cliente a cliente.
//
//   Asana -> Traffic: automático (hook asana-descriptions-tick, 30 min em horário comercial) ou
//     botão "Atualizar do Asana". Se a descrição já é igual, não faz nada; se divergiu, o Traffic
//     passa a ter a do Asana. Exceção: se o usuário tem um rascunho NÃO enviado (draft), ele é
//     preservado — só o botão "Enviar ao Asana" sobrescreve o Asana.
//   Traffic -> Asana: só pelo botão por cliente. SUBSTITUI a descrição (não acrescenta).
//
// Texto simples: a descrição é lida/gravada como `notes`. Se a tarefa tem formatação (negrito, lista,
// link...), o envio de texto simples pede confirmação antes (perde a formatação). Pra manter a formatação, o Foco
// edita o `html_notes` direto (getLiveHtml / sendHtmlToAsana) — a tela Descrição continua em texto simples.

import type { createClient } from "@/lib/supabase/server";
import { asanaConfigured, asanaFetch, listSectionTasks, matchTask, type AsanaTask } from "@/lib/asana/priority-sync";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;

export const ASANA_PROJECT_GID = "1208798639166829"; // ESTRATEGISTA SPEED DIGITAL (pro link da tarefa)

export interface ClientDescriptionRow {
  user_id: string;
  ad_account_id: string;
  client_name: string | null;
  asana_task_gid: string | null;
  asana_task_name: string | null;
  asana_description: string;
  asana_has_rich: boolean;
  match_status: "ok" | "not_found" | "ambiguous" | "pending";
  draft: string | null;
  synced_at: string | null;
}

export interface DescriptionSyncSummary {
  configured: boolean;
  checked: number;
  updated: string[]; // clientes cuja descrição mudou no Asana e foi atualizada aqui
  notFound: string[];
  ambiguous: string[];
  errors: string[];
}

// Marcas de formatação que o texto simples perderia (as mesmas tags que o Asana aceita).
const RICH_TAG = /<(strong|em|u|s|code|ol|ul|li|a|blockquote|pre|h1|h2|hr|img)[\s>/]/i;
export function hasRichFormatting(html: string | null | undefined): boolean {
  return RICH_TAG.test(html ?? "");
}

// Quebras de linha iguais e sem espaço sobrando no fim — só pra COMPARAR se duas descrições são iguais.
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string | null | undefined) => (x ?? "").replace(/\r\n?/g, "\n").trimEnd();
  return n(a) === n(b);
}

function clean(notes: string | undefined): string {
  return (notes ?? "").replace(/\r\n?/g, "\n");
}

export async function syncDescriptionsFromAsana(db: Db, userId: string): Promise<DescriptionSyncSummary> {
  const summary: DescriptionSyncSummary = { configured: asanaConfigured(), checked: 0, updated: [], notFound: [], ambiguous: [], errors: [] };
  if (!summary.configured) return summary;

  const { data: selected, error: selErr } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (selErr) throw selErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return summary;

  const [{ data: bindings, error: bindErr }, { data: existing, error: exErr }] = await Promise.all([
    db.from("account_bindings").select("ad_account_id, client_name").eq("user_id", userId).in("ad_account_id", accountIds),
    db.from("client_descriptions").select("*").eq("user_id", userId),
  ]);
  if (bindErr) throw bindErr;
  if (exErr) throw exErr;
  const nameByAccount = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, ((b.client_name as string | null) ?? "").trim()]));
  const prevByAccount = new Map((existing ?? []).map((r) => [r.ad_account_id as string, r as ClientDescriptionRow]));

  let tasks: AsanaTask[];
  try {
    tasks = await listSectionTasks("name,notes,html_notes");
  } catch (e) {
    summary.errors.push(`Não consegui ler a seção no Asana: ${(e as Error).message}`);
    return summary;
  }
  const taskByGid = new Map(tasks.map((t) => [t.gid, t]));
  const nowIso = new Date().toISOString();

  for (const accountId of accountIds) {
    const clientName = nameByAccount.get(accountId) ?? "";
    if (!clientName) continue;
    summary.checked++;
    const prev = prevByAccount.get(accountId);

    // Mantém a tarefa já ligada, a menos que o nome do cliente tenha mudado ou a tarefa tenha sumido.
    let task: AsanaTask | undefined;
    let reason: "notFound" | "ambiguous" | undefined;
    if (prev?.asana_task_gid && prev.client_name === clientName) task = taskByGid.get(prev.asana_task_gid);
    if (!task) {
      const m = matchTask(clientName, tasks);
      task = m.task ? taskByGid.get(m.task.gid) : undefined;
      reason = m.reason;
    }

    try {
      if (!task) {
        const status = reason === "ambiguous" ? "ambiguous" : "not_found";
        (status === "ambiguous" ? summary.ambiguous : summary.notFound).push(clientName);
        if (prev && prev.match_status === status && prev.client_name === clientName && !prev.asana_task_gid) continue; // nada mudou
        const { error } = await db.from("client_descriptions").upsert(
          { user_id: userId, ad_account_id: accountId, client_name: clientName, asana_task_gid: null, asana_task_name: null, match_status: status, synced_at: nowIso, updated_at: nowIso },
          { onConflict: "user_id,ad_account_id" },
        );
        if (error) throw error;
        continue;
      }

      const notes = clean(task.notes);
      const rich = hasRichFormatting(task.html_notes);
      const unchanged =
        prev &&
        prev.match_status === "ok" &&
        prev.asana_task_gid === task.gid &&
        prev.client_name === clientName &&
        prev.asana_has_rich === rich &&
        sameText(prev.asana_description, notes);
      if (unchanged) continue; // igual: não faz nada
      const textChanged = !prev || !sameText(prev.asana_description, notes);

      const row: Record<string, unknown> = {
        user_id: userId,
        ad_account_id: accountId,
        client_name: clientName,
        asana_task_gid: task.gid,
        asana_task_name: task.name.trim(),
        asana_description: notes,
        asana_has_rich: rich,
        match_status: "ok",
        synced_at: nowIso,
        updated_at: nowIso,
      };
      // Rascunho que ficou igual ao Asana (ex.: foi enviado por outro caminho) não precisa mais existir.
      if (prev?.draft != null && sameText(prev.draft, notes)) row.draft = null;
      const { error } = await db.from("client_descriptions").upsert(row, { onConflict: "user_id,ad_account_id" });
      if (error) throw error;
      if (textChanged) summary.updated.push(clientName);
    } catch (e) {
      summary.errors.push(`${clientName}: ${(e as Error).message}`);
    }
  }
  return summary;
}

export type SendDescriptionResult =
  | { ok: true }
  | { ok: false; code: "not_configured" | "no_task" | "no_draft" | "conflict" | "rich"; message: string };

// Traffic -> Asana: grava o rascunho como a descrição da tarefa (substitui, não acrescenta).
export async function sendDescriptionToAsana(
  db: Db,
  userId: string,
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<SendDescriptionResult> {
  if (!asanaConfigured()) {
    return { ok: false, code: "not_configured", message: "Falta configurar ASANA_ACCESS_TOKEN na Vercel." };
  }
  const { data, error } = await db.from("client_descriptions").select("*").eq("user_id", userId).eq("ad_account_id", accountId).maybeSingle();
  if (error) throw error;
  const row = data as ClientDescriptionRow | null;
  if (!row?.asana_task_gid || row.match_status !== "ok") {
    return { ok: false, code: "no_task", message: "Esse cliente ainda não está ligado a uma tarefa do Asana (confira o nome do cliente)." };
  }
  if (row.draft == null || sameText(row.draft, row.asana_description)) {
    return { ok: false, code: "no_draft", message: "Não há alteração para enviar." };
  }

  // Confere o que está no Asana AGORA, antes de sobrescrever.
  const current = ((await asanaFetch(`/tasks/${row.asana_task_gid}?opt_fields=notes,html_notes`)) as {
    data?: { notes?: string; html_notes?: string };
  }).data;
  const currentNotes = clean(current?.notes);
  if (!opts.force) {
    if (!sameText(currentNotes, row.asana_description)) {
      return {
        ok: false,
        code: "conflict",
        message: "A descrição mudou no Asana desde a última sincronização. Se enviar, o texto de lá será substituído pelo seu.",
      };
    }
    if (hasRichFormatting(current?.html_notes)) {
      return {
        ok: false,
        code: "rich",
        message: "A descrição no Asana tem formatação (negrito, lista ou link). Ao enviar como texto simples, a formatação será perdida.",
      };
    }
  }

  await asanaFetch(`/tasks/${row.asana_task_gid}`, { method: "PUT", body: JSON.stringify({ data: { notes: row.draft } }) });
  const nowIso = new Date().toISOString();
  const { error: upErr } = await db
    .from("client_descriptions")
    .update({ asana_description: row.draft, asana_has_rich: false, draft: null, synced_at: nowIso, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("ad_account_id", accountId);
  if (upErr) throw upErr;
  return { ok: true };
}

// Formatação preservada: lê o html_notes da tarefa AGORA (pro editor do Foco).
export async function getLiveHtml(db: Db, userId: string, accountId: string): Promise<{ html: string; notes: string } | null> {
  if (!asanaConfigured()) return null;
  const { data, error } = await db.from("client_descriptions").select("asana_task_gid, match_status").eq("user_id", userId).eq("ad_account_id", accountId).maybeSingle();
  if (error) throw error;
  if (!data?.asana_task_gid || data.match_status !== "ok") return null;
  const cur = ((await asanaFetch(`/tasks/${data.asana_task_gid}?opt_fields=notes,html_notes`)) as { data?: { notes?: string; html_notes?: string } }).data;
  return { html: cur?.html_notes ?? "", notes: clean(cur?.notes) };
}

// Traffic -> Asana COM formatação: grava o html_notes (substitui a descrição inteira). Confere antes se o texto
// do Asana mudou desde a última sincronização (a não ser que force).
export async function sendHtmlToAsana(
  db: Db,
  userId: string,
  accountId: string,
  html: string,
  opts: { force?: boolean } = {},
): Promise<SendDescriptionResult> {
  if (!asanaConfigured()) {
    return { ok: false, code: "not_configured", message: "Falta configurar ASANA_ACCESS_TOKEN na Vercel." };
  }
  const { data, error } = await db.from("client_descriptions").select("*").eq("user_id", userId).eq("ad_account_id", accountId).maybeSingle();
  if (error) throw error;
  const row = data as ClientDescriptionRow | null;
  if (!row?.asana_task_gid || row.match_status !== "ok") {
    return { ok: false, code: "no_task", message: "Esse cliente ainda não está ligado a uma tarefa do Asana (confira o nome do cliente)." };
  }
  const path = `/tasks/${row.asana_task_gid}`;
  if (!opts.force) {
    const cur = ((await asanaFetch(`${path}?opt_fields=notes`)) as { data?: { notes?: string } }).data;
    if (!sameText(clean(cur?.notes), row.asana_description)) {
      return {
        ok: false,
        code: "conflict",
        message: "A descrição mudou no Asana desde a última sincronização. Se enviar, o texto de lá será substituído pelo seu.",
      };
    }
  }
  await asanaFetch(path, { method: "PUT", body: JSON.stringify({ data: { html_notes: html } }) });
  const after = ((await asanaFetch(`${path}?opt_fields=notes,html_notes`)) as { data?: { notes?: string; html_notes?: string } }).data;
  const nowIso = new Date().toISOString();
  const { error: upErr } = await db
    .from("client_descriptions")
    .update({
      asana_description: clean(after?.notes),
      asana_has_rich: hasRichFormatting(after?.html_notes),
      draft: null,
      synced_at: nowIso,
      updated_at: nowIso,
    })
    .eq("user_id", userId)
    .eq("ad_account_id", accountId);
  if (upErr) throw upErr;
  return { ok: true };
}
