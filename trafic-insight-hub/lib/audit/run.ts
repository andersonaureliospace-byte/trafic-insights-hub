// Execução compartilhada das duas auditorias — usada tanto pela rota que o
// botão "Verificar agora" chama quanto pelo hook público que o n8n aciona
// periodicamente. Varre as contas vinculadas (account_bindings), pausa os
// conjuntos com problema e grava o resultado.

import type { createClient } from "@/lib/supabase/server";
import { auditAccountLocation, disableLocationExpansion, type AuditLocationIssue } from "./location";
import { auditAccountErrors, type AuditErrorIssue } from "./errors";
import { setEntitiesStatus } from "@/lib/meta/status";
import { publishAlert } from "@/lib/alerts/notifications";

// Aceita tanto o cliente com sessão (createClient, usado pela rota que o
// botão "Verificar agora" chama) quanto o cliente com service role
// (createServiceClient, usado pelo hook público que o n8n aciona).
type Db = Awaited<ReturnType<typeof createClient>>;

interface Binding {
  ad_account_id: string;
  client_name: string | null;
}

export interface AuditRunSummary {
  pausedCount: number;
  failedCount: number;
  fixedCount?: number; // localização: caixas de expansão desligadas (o conjunto segue ativo)
  checkedAccounts: number;
}

// Etapa 205: o que NÃO é erro de verdade não vira aviso (nem no grupo nem na aba Alertas) — anúncio em análise /
// pré-aprovado e "conjunto ativo sem anúncio ativo" (a verificação continua pausando esse conjunto, só não avisa).
// Avisa: reprovado, com problemas, pendência de cobrança.
const NOT_AN_ERROR = new Set(["Anúncio em análise", "Anúncio pré-aprovado (em análise)", "Conjunto ativo sem anúncio ativo"]);
function isRealError(i: AuditErrorIssue): boolean {
  return !i.reasons.some((r) => NOT_AN_ERROR.has(r));
}

function inFilterList(ids: string[]): string {
  return `(${ids.join(",")})`;
}

// Etapa 197: as Verificações (localização + erros) viraram alertas — tudo que elas acham/pausam/corrigem aparece na
// aba Alertas (não vai pro grupo). A tela "Verificações" saiu da Auditoria. Mesma lista de novo = atualiza o alerta
// aberto em vez de empilhar (as linhas vão em ordem fixa pra o texto bater).
async function publishAudit(supabase: Db, userId: string, kind: "audit-location" | "audit-errors", title: string, lines: string[]) {
  if (lines.length === 0) return;
  const sorted = [...lines].sort((a, b) => a.localeCompare(b, "pt-BR"));
  try {
    // Erros de veiculação vão também pro grupo do WhatsApp (GROUP_KINDS) — só quando a lista muda.
    await publishAlert(supabase, userId, {
      kind,
      title: `${title} (${sorted.length})`,
      body: sorted.join("\n"),
      count: sorted.length,
      skipGroupIfUnchanged: true,
    });
  } catch (e) {
    console.error("audit alert err (non-fatal)", kind, e);
  }
}

export async function runLocationAudit(
  supabase: Db,
  userId: string,
  token: string,
  bindings: Binding[],
  opts?: { sinceMs?: number },
): Promise<AuditRunSummary & { byAccount: Record<string, AuditLocationIssue[]> }> {
  let pausedCount = 0;
  let failedCount = 0;
  let fixedCount = 0;
  const byAccount: Record<string, AuditLocationIssue[]> = {};
  const now = new Date().toISOString();
  const alertLines: string[] = [];

  for (const b of bindings) {
    let issues: AuditLocationIssue[] = [];
    let checkedIds: string[] = [];
    try {
      const res = await auditAccountLocation(token, b.ad_account_id, { sinceMs: opts?.sinceMs });
      issues = res.issues;
      checkedIds = res.checkedIds;
    } catch {
      // Conta inacessível: não gera falso alerta (e não limpa nada da lista).
      issues = [];
      if (opts?.sinceMs) continue;
    }

    // Brasil inteiro: pausa (como sempre). Expansão de público: NUNCA pausa — só desliga a caixa e o conjunto segue ativo.
    const toPause = issues.filter((i) => i.pause);
    const pauseById = new Map<string, { ok: boolean; error?: string }>();
    if (toPause.length > 0) {
      const results = await setEntitiesStatus(
        token,
        toPause.map((i) => ({ id: i.adset_id, type: "adset" as const })),
        "PAUSED",
      );
      for (const r of results) {
        pauseById.set(r.id, r);
        if (r.ok) pausedCount++;
        else failedCount++;
      }
    }

    const fixById = new Map<string, { ok: boolean; error?: string }>();
    for (const i of issues.filter((x) => x.expansion)) {
      const r = await disableLocationExpansion(token, i.adset_id);
      fixById.set(i.adset_id, r);
      if (r.ok) fixedCount++;
      else failedCount++;
    }

    // O que continua "incorreto": conjuntos de Brasil inteiro (pausados) e expansões que não deu pra desligar.
    // Expansão desligada com sucesso e conjunto sem outro problema = resolvido, some da lista.
    const remaining = issues.filter((i) => i.pause || (i.expansion && !fixById.get(i.adset_id)?.ok));
    byAccount[b.ad_account_id] = remaining;

    for (const i of issues) {
      const acts: string[] = [];
      if (i.pause) acts.push(pauseById.get(i.adset_id)?.ok ? "Brasil inteiro → conjunto pausado" : `Brasil inteiro → falha ao pausar (${pauseById.get(i.adset_id)?.error ?? "erro"})`);
      if (i.expansion) acts.push(fixById.get(i.adset_id)?.ok ? "expansão de público desligada" : `falha ao desligar a expansão (${fixById.get(i.adset_id)?.error ?? "erro"})`);
      alertLines.push(`${b.client_name ?? b.ad_account_id} — ${i.adset_name}: ${acts.join(" · ")}`);
    }

    if (remaining.length > 0) {
      await supabase.from("audit_location_status").upsert(
        remaining.map((i) => {
          const p = pauseById.get(i.adset_id);
          const f = fixById.get(i.adset_id);
          return {
            user_id: userId,
            ad_account_id: b.ad_account_id,
            adset_id: i.adset_id,
            adset_name: i.adset_name,
            status: "incorrect",
            detail: {
              campaign_name: i.campaign_name,
              reasons: i.reasons,
              paused: i.pause ? !!p?.ok : undefined,
              pause_error: i.pause ? (p?.ok ? null : (p?.error ?? "Falha ao pausar")) : null,
              expansion_fixed: i.expansion ? !!f?.ok : undefined,
              fix_error: i.expansion && !f?.ok ? (f?.error ?? "Falha ao desligar a expansão") : null,
            },
            checked_at: now,
          };
        }),
        { onConflict: "user_id,adset_id" },
      );
    }

    // Limpa da tabela os conjuntos dessa conta que não têm mais problema.
    // Varredura completa: limpa tudo que não está mais na lista. Modo "recentes" (Etapa 182): só limpa os conjuntos
    // que foram conferidos agora e estão ok — o resto da lista fica pra varredura completa.
    const currentIds = remaining.map((i) => i.adset_id);
    if (opts?.sinceMs) {
      const okIds = checkedIds.filter((id) => !currentIds.includes(id));
      if (okIds.length > 0) {
        await supabase.from("audit_location_status").delete().eq("user_id", userId).eq("ad_account_id", b.ad_account_id).in("adset_id", okIds);
      }
    } else {
      const del = supabase.from("audit_location_status").delete().eq("user_id", userId).eq("ad_account_id", b.ad_account_id);
      await (currentIds.length > 0 ? del.not("adset_id", "in", inFilterList(currentIds)) : del);
    }
  }

  await publishAudit(supabase, userId, "audit-location", "📍 Localização dos conjuntos corrigida", alertLines);
  return { pausedCount, failedCount, fixedCount, checkedAccounts: bindings.length, byAccount };
}

export async function runErrorAudit(
  supabase: Db,
  userId: string,
  token: string,
  bindings: Binding[],
): Promise<AuditRunSummary & { byAccount: Record<string, AuditErrorIssue[]> }> {
  let pausedCount = 0;
  let failedCount = 0;
  const byAccount: Record<string, AuditErrorIssue[]> = {};
  const now = new Date().toISOString();
  const alertLines: string[] = [];

  for (const b of bindings) {
    let issues: AuditErrorIssue[] = [];
    try {
      const res = await auditAccountErrors(token, b.ad_account_id);
      issues = res.issues;
    } catch {
      issues = [];
    }
    byAccount[b.ad_account_id] = issues;

    // Etapa 199: avisa cada erro UMA vez só. O que já estava na lista desta conta (audit_error_status) já foi avisado;
    // só entra no alerta o que é novo. Se o erro some (a linha é apagada) e volta depois, avisa de novo.
    let seen = new Set<string>();
    if (issues.length > 0) {
      const { data: prev } = await supabase
        .from("audit_error_status")
        .select("entity_id")
        .eq("user_id", userId)
        .eq("ad_account_id", b.ad_account_id);
      seen = new Set((prev ?? []).map((r) => r.entity_id as string));
    }

    let byId = new Map<string, { id: string; ok: boolean; error?: string }>();
    if (issues.length > 0) {
      const targets = new Map<string, { id: string; type: "adset" }>();
      // Etapa 122: só pausa conjunto "sem anúncio ativo" (já conferido em auditAccountErrors); anúncio em
      // análise/com erro é só aviso, não pausa o conjunto.
      for (const i of issues) {
        if (i.entity_type === "adset" && i.adset_id && !i.hold && !targets.has(i.adset_id)) targets.set(i.adset_id, { id: i.adset_id, type: "adset" });
      }
      if (targets.size > 0) {
        const results = await setEntitiesStatus(token, [...targets.values()], "PAUSED");
        byId = new Map(results.map((r) => [r.id, r]));
        for (const r of results) {
          if (r.ok) pausedCount++;
          else failedCount++;
        }
      }

      for (const i of issues) {
        if (seen.has(i.entity_id)) continue; // já avisado
        if (!isRealError(i)) continue; // em análise / sem anúncio ativo: não é erro, não avisa
        const r = i.adset_id ? byId.get(i.adset_id) : undefined;
        const note =
          i.entity_type === "adset" && i.adset_id
            ? i.hold
              ? ` · mantido ativo (${i.hold})`
              : r?.ok
                ? " · conjunto pausado"
                : ` · falha ao pausar: ${r?.error ?? "erro desconhecido"}`
            : "";
        alertLines.push(`${b.client_name ?? b.ad_account_id} — ${i.entity_name}: ${i.reasons.join(" · ")}${note}`);
      }

      await supabase.from("audit_error_status").upsert(
        issues.map((i) => {
          const r = i.adset_id ? byId.get(i.adset_id) : undefined;
          const pauseNote = i.entity_type === "adset" && i.adset_id
            ? i.hold
              ? ` · mantido ativo (${i.hold})`
              : r?.ok
                ? " · conjunto pausado"
                : ` · falha ao pausar: ${r?.error ?? "erro desconhecido"}`
            : "";
          return {
            user_id: userId,
            ad_account_id: b.ad_account_id,
            entity_type: i.entity_type,
            entity_id: i.entity_id,
            entity_name: i.entity_name,
            error_message: `${i.reasons.join(" · ")}${pauseNote}`,
            checked_at: now,
          };
        }),
        { onConflict: "user_id,entity_id,error_message" },
      );
    }

    const currentEntityIds = issues.map((i) => i.entity_id);
    const del = supabase.from("audit_error_status").delete().eq("user_id", userId).eq("ad_account_id", b.ad_account_id);
    await (currentEntityIds.length > 0 ? del.not("entity_id", "in", inFilterList(currentEntityIds)) : del);
  }

  await publishAudit(supabase, userId, "audit-errors", "⚠️ Novo erro de veiculação", alertLines);
  return { pausedCount, failedCount, checkedAccounts: bindings.length, byAccount };
}
