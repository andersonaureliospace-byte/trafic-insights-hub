// Etapa 257: fila de avisos das Auditorias + resumo. Nada sai na hora: cada achado entra na fila e, nos horários de
// resumo, vai UMA mensagem por grupo, separada por gestor (responsável da conta) e, dentro de cada gestor, por tipo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { CHECK_BY_ID, groupFor, type AuditConfig, type CheckId } from "./config";
import type { Finding } from "./checks";

// Ordem e título de cada seção dentro do gestor.
const SECTIONS: Array<{ id: CheckId | "custo_pausa"; title: string }> = [
  { id: "custo_pausa", title: "🚨 Criativos pausados agora (custo 3x o ideal)" },
  { id: "saldo", title: "💰 Saldo / pagamento" },
  { id: "sem_entrega", title: "⛔ Sem entrega" },
  { id: "erros", title: "❌ Erros de veiculação" },
  { id: "cpa_dia", title: "🔴 CPA alto hoje" },
  { id: "custo", title: "⚠️ Custo alto (acima de 2x o ideal)" },
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

export function buildDigest(items: ItemRow[], slot: string): string {
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

  const out: string[] = [`📋 *Auditorias — resumo das ${slot.replace(":", "h")}*`, `${uniq.length} ${uniq.length === 1 ? "item" : "itens"}`];
  for (const r of resps) {
    const list = byResp.get(r) ?? [];
    out.push("", `👤 *${r.toUpperCase()}* (${list.length})`);
    for (const s of SECTIONS) {
      const sec = list.filter((i) => i.check_id === s.id);
      if (sec.length === 0) continue;
      out.push(`*${s.title}*`);
      for (const i of sec.sort((a, b) => a.client_name.localeCompare(b.client_name, "pt-BR"))) out.push(`• ${i.client_name} — ${i.line}`);
    }
  }
  return out.join("\n");
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
export async function sendDigest(db: SupabaseClient, userId: string, cfg: AuditConfig, slot: string): Promise<DigestResult> {
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
  const noGroup = resolved.filter((i) => !i.group_id).length;
  const byGroup = new Map<string, ItemRow[]>();
  for (const i of resolved) if (i.group_id) byGroup.set(i.group_id, [...(byGroup.get(i.group_id) ?? []), i]);
  if (byGroup.size === 0) return { groups: 0, items: 0, noGroup, error: noGroup ? "Nenhum grupo escolhido em Automações → Auditorias." : null };

  const inst = await requireWhatsappInstance(db as never, userId);
  const creds = { api_url: inst.api_url, token: inst.token };
  let sentItems = 0;
  let lastError: string | null = null;
  for (const [groupId, list] of byGroup) {
    try {
      for (const part of chunks(buildDigest(list, slot))) await sendText(creds, groupId, part);
      const now = new Date().toISOString();
      const ids = list.map((i) => i.id);
      for (let k = 0; k < ids.length; k += 200) {
        await db.from("estr_digest_items").update({ sent_at: now }).in("id", ids.slice(k, k + 200));
      }
      sentItems += list.length;
    } catch (e) {
      lastError = `${list[0]?.group_name ?? groupId}: ${(e as Error).message.slice(0, 200)}`;
    }
  }
  // Limpa o que já foi enviado há mais de 15 dias (as chaves de "1x por dia" só precisam de 1 dia).
  await db.from("estr_digest_items").delete().eq("user_id", userId).lt("sent_at", new Date(Date.now() - 15 * 86_400_000).toISOString());
  return { groups: byGroup.size, items: sentItems, noGroup, error: lastError };
}

export const checkLabel = (id: string) => (id === "custo_pausa" ? "Pausados (custo 3x)" : (CHECK_BY_ID[id as CheckId]?.name ?? id));


// Etapa 284: aviso URGENTE de pagamento / saldo — sai na hora (não espera o resumo). Só o que é novo no dia (a chave
// "urgente:…:dia" não deixa repetir). Vai pro grupo do Saldo, separado por gestor.
export async function sendUrgent(db: SupabaseClient, userId: string, cfg: AuditConfig, findings: Finding[]): Promise<{ sent: number; error: string | null }> {
  if (findings.length === 0) return { sent: 0, error: null };
  const g = groupFor(cfg, "saldo");
  const rows = findings.map((f) => ({
    user_id: userId,
    check_id: "saldo",
    ad_account_id: f.acc.id,
    client_name: f.acc.name,
    responsible: f.acc.responsible,
    line: f.line.slice(0, 500),
    dedupe_key: f.dedupe ?? null,
    group_id: g?.id ?? null,
    group_name: g?.name ?? null,
    sent_at: g ? new Date().toISOString() : null, // já sai agora; sem grupo fica na fila (aparece no resumo/tela)
  }));
  const { data, error } = await db
    .from("estr_digest_items")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("client_name, responsible, line");
  if (error) return { sent: 0, error: `fila de avisos: ${error.message}` };
  const novos = (data ?? []) as Array<{ client_name: string; responsible: string | null; line: string }>;
  if (novos.length === 0 || !g) return { sent: 0, error: g ? null : "Nenhum grupo escolhido pro Saldo em Automações → Auditorias." };

  const byResp = new Map<string, typeof novos>();
  for (const n of novos) {
    const r = n.responsible?.trim() || "Sem responsável";
    byResp.set(r, [...(byResp.get(r) ?? []), n]);
  }
  const out = ["🚨 *URGENTE — pagamento / saldo*"];
  for (const r of [...byResp.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    out.push("", `👤 *${r.toUpperCase()}*`);
    for (const n of byResp.get(r) ?? []) out.push(`• ${n.client_name} — ${n.line}`);
  }
  try {
    const inst = await requireWhatsappInstance(db as never, userId);
    for (const part of chunks(out.join("\n"))) await sendText({ api_url: inst.api_url, token: inst.token }, g.id, part);
    return { sent: novos.length, error: null };
  } catch (e) {
    return { sent: 0, error: (e as Error).message.slice(0, 200) };
  }
}
