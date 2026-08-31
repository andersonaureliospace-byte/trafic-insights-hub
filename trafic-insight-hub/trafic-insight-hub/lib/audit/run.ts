// Execução compartilhada das duas auditorias — usada tanto pela rota que o
// botão "Verificar agora" chama quanto pelo hook público que o n8n aciona
// periodicamente. Varre as contas vinculadas (account_bindings), pausa os
// conjuntos com problema e grava o resultado.

import type { createClient } from "@/lib/supabase/server";
import { auditAccountLocation, type AuditLocationIssue } from "./location";
import { auditAccountErrors, type AuditErrorIssue } from "./errors";
import { setEntitiesStatus } from "@/lib/meta/status";

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
  checkedAccounts: number;
}

function inFilterList(ids: string[]): string {
  return `(${ids.join(",")})`;
}

export async function runLocationAudit(
  supabase: Db,
  userId: string,
  token: string,
  bindings: Binding[],
): Promise<AuditRunSummary & { byAccount: Record<string, AuditLocationIssue[]> }> {
  let pausedCount = 0;
  let failedCount = 0;
  const byAccount: Record<string, AuditLocationIssue[]> = {};
  const now = new Date().toISOString();

  for (const b of bindings) {
    let issues: AuditLocationIssue[] = [];
    try {
      const res = await auditAccountLocation(token, b.ad_account_id);
      issues = res.issues;
    } catch {
      // Conta inacessível: não gera falso alerta.
      issues = [];
    }
    byAccount[b.ad_account_id] = issues;

    if (issues.length > 0) {
      const results = await setEntitiesStatus(
        token,
        issues.map((i) => ({ id: i.adset_id, type: "adset" as const })),
        "PAUSED",
      );
      const byId = new Map(results.map((r) => [r.id, r]));
      for (const r of results) {
        if (r.ok) pausedCount++;
        else failedCount++;
      }

      await supabase.from("audit_location_status").upsert(
        issues.map((i) => {
          const r = byId.get(i.adset_id);
          return {
            user_id: userId,
            ad_account_id: b.ad_account_id,
            adset_id: i.adset_id,
            adset_name: i.adset_name,
            status: "incorrect",
            detail: {
              campaign_name: i.campaign_name,
              reasons: i.reasons,
              paused: !!r?.ok,
              pause_error: r?.ok ? null : (r?.error ?? "Falha ao pausar"),
            },
            checked_at: now,
          };
        }),
        { onConflict: "user_id,adset_id" },
      );
    }

    // Limpa da tabela os conjuntos dessa conta que não têm mais problema.
    const currentIds = issues.map((i) => i.adset_id);
    const del = supabase.from("audit_location_status").delete().eq("user_id", userId).eq("ad_account_id", b.ad_account_id);
    await (currentIds.length > 0 ? del.not("adset_id", "in", inFilterList(currentIds)) : del);
  }

  return { pausedCount, failedCount, checkedAccounts: bindings.length, byAccount };
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

  for (const b of bindings) {
    let issues: AuditErrorIssue[] = [];
    try {
      const res = await auditAccountErrors(token, b.ad_account_id);
      issues = res.issues;
    } catch {
      issues = [];
    }
    byAccount[b.ad_account_id] = issues;

    let byId = new Map<string, { id: string; ok: boolean; error?: string }>();
    if (issues.length > 0) {
      const targets = new Map<string, { id: string; type: "adset" }>();
      for (const i of issues) {
        if (i.adset_id && !targets.has(i.adset_id)) targets.set(i.adset_id, { id: i.adset_id, type: "adset" });
      }
      if (targets.size > 0) {
        const results = await setEntitiesStatus(token, [...targets.values()], "PAUSED");
        byId = new Map(results.map((r) => [r.id, r]));
        for (const r of results) {
          if (r.ok) pausedCount++;
          else failedCount++;
        }
      }

      await supabase.from("audit_error_status").upsert(
        issues.map((i) => {
          const r = i.adset_id ? byId.get(i.adset_id) : undefined;
          const pauseNote = i.adset_id
            ? r?.ok
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

  return { pausedCount, failedCount, checkedAccounts: bindings.length, byAccount };
}
