// Etapa 257: fila de avisos das Auditorias. Etapa 300: não acumula mais pro resumo — ao fim de cada batida (15 min)
// o que entrou na fila sai na hora, uma mensagem por grupo, separada por gestor (marcado no grupo) e por tipo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { CHECK_BY_ID, groupFor, isDireto, type AuditConfig, type CheckId } from "./config";
import { ROBO, gestorHeader, loadGestorNumbers } from "./gestores";
import type { Finding } from "./checks";

// Ordem e título de cada seção dentro do gestor.
const SECTIONS: Array<{ id: CheckId | "custo_pausa"; title: string }> = [
  { id: "custo_pausa", title: "🚨 Criativos pausados agora (custo 3x o ideal)" },
  { id: "saldo", title: "💰 Saldo / pagamento" },
  { id: "sem_entrega", title: "⛔ Sem entrega" },
  { id: "erros", title: "❌ Erros de veiculação" },
  { id: "cpa_dia", title: "🔴 CPA alto hoje" },
  { id: "whatsapp", title: "💬 WhatsApp diferente da ficha" },
  { id: "expansao", title: "📍 Localização corrigida" },
  { id: "verba_diaria", title: "📉 Investimento diário baixo" },
  { id: "verba_mensal", title: "📅 Investimento do mês fora do ritmo" },
  { id: "prioridade", title: "🏷️ Prioridade (Asana)" },
];

export async function queueFindings(db: SupabaseClient, userId: string, cfg: AuditConfig, findings: Finding[]): Promise<number> {
  if (findings.length === 0) return 0;
  const rows = findings.map((f) => {
    const g = groupFor(cfg, f.check === "custo_pausa" ? "custo" : f.check);
    return {
      user_id: userId,
      check_id: f.check,
      ad_account_id: f.acc.id,
      client_name: f.acc.name,
      responsible: f.acc.responsible,
      line: f.line.slice(0, 500),
      dedupe_key: f.dedupe ?? null,
      group_id: g?.id ?? null,
      group_name: g?.name ?? null,
    };
  });
  // Itens com dedupe_key repetido são ignorados (já estão na fila ou já foram enviados).
  const { data, error } = await db.from("estr_digest_items").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`fila de avisos: ${error.message}`);
  return data?.length ?? 0;
}

interface ItemRow {
  id: string;
  check_id: string;
  ad_account_id: string;
  client_name: string;
  responsible: string | null;
  line: string;
  group_id: string | null;
  group_name: string | null;
  created_at: string;
}

export function buildDigest(items: ItemRow[], nums: Map<string, string> = new Map(), privado = false): { text: string; mentions: string[] } {
  // Mesmo tipo + mesma conta + mesma linha repetida (ex.: saldo em duas rodadas antes do resumo): fica só a mais nova.
  const seen = new Set<string>();
  const uniq = [...items]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((i) => {
      const k =
        i.check_id === "saldo"
          ? `saldo:${i.ad_account_id}:${i.line.startsWith("Pagamento") ? "pag" : "saldo"}`
          : i.check_id === "cpa_dia"
            ? `cpa_dia:${i.ad_account_id}`
            : i.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const byResp = new Map<string, ItemRow[]>();
  for (const i of uniq) {
    const r = i.responsible?.trim() || "Sem responsável";
    byResp.set(r, [...(byResp.get(r) ?? []), i]);
  }
  const resps = [...byResp.keys()].sort((a, b) => (a === "Sem responsável" ? 1 : b === "Sem responsável" ? -1 : a.localeCompare(b, "pt-BR")));

  const mentions: string[] = [];
  const out: string[] = [`${ROBO} *Auditoria*`];
  for (const r of resps) {
    const list = byResp.get(r) ?? [];
    out.push("");
    if (!privado) out.push(gestorHeader(r, nums, mentions));
    for (const s of SECTIONS) {
      const sec = list.filter((i) => i.check_id === s.id);
      if (sec.length === 0) continue;
      out.push(`*${s.title}*`);
      for (const i of sec.sort((a, b) => a.client_name.localeCompare(b.client_name, "pt-BR"))) out.push(`• ${i.client_name} — ${i.line}`);
    }
  }
  return { text: out.join("\n"), mentions };
}

// Quebra em partes de até ~3.800 caracteres (entre linhas), só se passar do tamanho de uma mensagem.
function chunks(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > max && cur) {
      parts.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) parts.push(cur);
  return parts.map((p, i) => (parts.length > 1 ? `${p}\n\n(${i + 1}/${parts.length})` : p));
}

export interface DigestResult {
  groups: number;
  items: number;
  noGroup: number;
  error: string | null;
}

// Manda tudo que está na fila (um resumo por grupo). Itens sem grupo configurado ficam na fila e aparecem na tela.
export async function sendDigest(db: SupabaseClient, userId: string, cfg: AuditConfig, _slot?: string): Promise<DigestResult> {
  const { data, error } = await db
    .from("estr_digest_items")
    .select("id, check_id, ad_account_id, client_name, responsible, line, group_id, group_name, created_at")
    .eq("user_id", userId)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return { groups: 0, items: 0, noGroup: 0, error: error.message };
  const items = (data ?? []) as ItemRow[];
  if (items.length === 0) return { groups: 0, items: 0, noGroup: 0, error: null };

  // Grupo atual da configuração vale mais que o gravado na hora (se você trocou o grupo depois).
  const resolved = items.map((i) => {
    const g = groupFor(cfg, (i.check_id === "custo_pausa" ? "custo" : i.check_id) as CheckId);
    return { ...i, group_id: g?.id ?? i.group_id, group_name: g?.name ?? i.group_name };
  });
  const nums = await loadGestorNumbers(db, userId);
  const inst = await requireWhatsappInstance(db as never, userId);
  const creds = { api_url: inst.api_url, token: inst.token };
  let sentItems = 0;
  let lastError: string | null = null;
  const marcar = async (ids: string[]) => {
    const now = new Date().toISOString();
    for (let k = 0; k < ids.length; k += 200) await db.from("estr_digest_items").update({ sent_at: now }).in("id", ids.slice(k, k + 200));
  };

  // Etapa 301: automações marcadas "direto pro gestor" vão no WhatsApp pessoal dele (gestor sem número segue pro grupo).
  const restantes: typeof resolved = [];
  const porNumero = new Map<string, ItemRow[]>();
  for (const i of resolved) {
    const num = nums.get((i.responsible ?? "").trim().toLowerCase());
    if (num && isDireto(cfg, (i.check_id === "custo_pausa" ? "custo" : i.check_id) as CheckId)) porNumero.set(num, [...(porNumero.get(num) ?? []), i]);
    else restantes.push(i);
  }
  for (const [num, list] of porNumero) {
    try {
      for (const part of chunks(buildDigest(list, nums, true).text)) await sendText(creds, num, part);
      await marcar(list.map((i) => i.id));
      sentItems += list.length;
    } catch (e) {
      lastError = `${list[0]?.responsible ?? num}: ${(e as Error).message.slice(0, 200)}`;
    }
  }

  const noGroup = restantes.filter((i) => !i.group_id).length;
  const byGroup = new Map<string, ItemRow[]>();
  for (const i of restantes) if (i.group_id) byGroup.set(i.group_id, [...(byGroup.get(i.group_id) ?? []), i]);
  if (byGroup.size === 0) return { groups: porNumero.size, items: sentItems, noGroup, error: lastError ?? (noGroup ? "Nenhum grupo escolhido em Automações → Auditorias." : null) };
  for (const [groupId, list] of byGroup) {
    try {
      const d = buildDigest(list, nums);
      for (const part of chunks(d.text)) await sendText(creds, groupId, part, { mentions: d.mentions });
      await marcar(list.map((i) => i.id));
      sentItems += list.length;
    } catch (e) {
      lastError = `${list[0]?.group_name ?? groupId}: ${(e as Error).message.slice(0, 200)}`;
    }
  }
  // Limpa o que já foi enviado há mais de 15 dias (as chaves de "1x por dia" só precisam de 1 dia).
  await db.from("estr_digest_items").delete().eq("user_id", userId).lt("sent_at", new Date(Date.now() - 15 * 86_400_000).toISOString());
  return { groups: byGroup.size + porNumero.size, items: sentItems, noGroup, error: lastError };
}

export const checkLabel = (id: string) => (id === "custo_pausa" ? "Pausados (custo 3x)" : (CHECK_BY_ID[id as CheckId]?.name ?? id));


// Etapa 284: aviso URGENTE de pagamento / saldo — sai na hora (não espera o resumo). Só o que é novo no dia (a chave
// "urgente:…:dia" não deixa repetir). Vai pro grupo do Saldo, separado por gestor.
export async function sendUrgent(
  db: SupabaseClient,
  userId: string,
  cfg: AuditConfig,
  findings: Finding[],
  // Etapa 295: também usado pro WhatsApp do anúncio diferente da ficha
  check: CheckId = "saldo",
  titulo = `${ROBO} 🚨 *URGENTE — pagamento / saldo*`,
): Promise<{ sent: number; error: string | null }> {
  if (findings.length === 0) return { sent: 0, error: null };
  const g = groupFor(cfg, check);
  const nums = await loadGestorNumbers(db, userId);
  const direto = isDireto(cfg, check);
  const temNumero = (r: string | null) => direto && nums.has((r ?? "").trim().toLowerCase());
  const rows = findings.map((f) => ({
    user_id: userId,
    check_id: check,
    ad_account_id: f.acc.id,
    client_name: f.acc.name,
    responsible: f.acc.responsible,
    line: f.line.slice(0, 500),
    dedupe_key: f.dedupe ?? null,
    group_id: g?.id ?? null,
    group_name: g?.name ?? null,
    sent_at: g || temNumero(f.acc.responsible) ? new Date().toISOString() : null, // já sai agora; sem destino fica na fila
  }));
  const { data, error } = await db
    .from("estr_digest_items")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("client_name, responsible, line");
  if (error) return { sent: 0, error: `fila de avisos: ${error.message}` };
  const novos = (data ?? []) as Array<{ client_name: string; responsible: string | null; line: string }>;
  if (novos.length === 0) return { sent: 0, error: null };
  const cab = titulo.startsWith(ROBO) ? titulo : `${ROBO} ${titulo}`;
  const inst0 = await requireWhatsappInstance(db as never, userId);
  const creds0 = { api_url: inst0.api_url, token: inst0.token };
  let enviados = 0;
  let erro: string | null = null;

  // Etapa 301: direto pro gestor (quem tem número cadastrado); o resto vai pro grupo.
  const privados = new Map<string, typeof novos>();
  const doGrupo: typeof novos = [];
  for (const n of novos) {
    const num = temNumero(n.responsible) ? (nums.get((n.responsible ?? "").trim().toLowerCase()) as string) : "";
    if (num) privados.set(num, [...(privados.get(num) ?? []), n]);
    else doGrupo.push(n);
  }
  for (const [num, list] of privados) {
    try {
      for (const part of chunks([cab, "", ...list.map((n) => `• ${n.client_name} — ${n.line}`)].join("\n"))) await sendText(creds0, num, part);
      enviados += list.length;
    } catch (e) {
      erro = (e as Error).message.slice(0, 200);
    }
  }
  if (doGrupo.length === 0) return { sent: enviados, error: erro };
  if (!g) return { sent: enviados, error: `Nenhum grupo escolhido pra "${check}" em Automações → Auditorias.` };

  const byResp = new Map<string, typeof novos>();
  for (const n of doGrupo) {
    const r = n.responsible?.trim() || "Sem responsável";
    byResp.set(r, [...(byResp.get(r) ?? []), n]);
  }
  const mentions: string[] = [];
  const out = [cab];
  for (const r of [...byResp.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    out.push("", gestorHeader(r, nums, mentions));
    for (const n of byResp.get(r) ?? []) out.push(`• ${n.client_name} — ${n.line}`);
  }
  try {
    for (const part of chunks(out.join("\n"))) await sendText(creds0, g.id, part, { mentions });
    return { sent: enviados + doGrupo.length, error: erro };
  } catch (e) {
    return { sent: enviados, error: (e as Error).message.slice(0, 200) };
  }
}
