// Padrão de nomes (Etapa 140) — varredura na Meta + ajuste automático de idade/data.
// Escopo: contas exibidas, ativas e "IVS" (o padrão de nomes é das unidades IVS). Só olha o que está ATIVO
// (campanhas, conjuntos e anúncios), e ignora campanhas [VAGA] (têm padrão próprio).

import type { createClient } from "@/lib/supabase/server";
import { metaGetAll, metaPost } from "@/lib/meta/client";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { publishAlert } from "@/lib/alerts/notifications";
import { checkAdName, checkAdsetName, checkCampaignName, type TargetingLike } from "@/lib/naming/rules";

type Db = Awaited<ReturnType<typeof createClient>>;

export type NamingEntity = "campaign" | "adset" | "ad";

export interface NamingItem {
  entity: NamingEntity;
  id: string;
  ad_account_id: string;
  client_name: string;
  current_name: string;
  suggestion: string | null;
  problems: string[];
  needsInput: boolean;
  autoFix: boolean;
}

export interface NamingAccount {
  ad_account_id: string;
  client_name: string;
}

const VAGA_RE = /\bvaga\b/i;
const CONCURRENCY = 3;
const RENAME_DELAY_MS = 2000;

export async function namingAccounts(db: Db, userId: string): Promise<NamingAccount[]> {
  const { data: selected, error } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (error) throw error;
  const off = await inactiveAccountIds(db, userId);
  const ids = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (ids.length === 0) return [];
  const { data: bindings, error: bErr } = await db.from("account_bindings").select("ad_account_id, client_name").eq("user_id", userId).in("ad_account_id", ids);
  if (bErr) throw bErr;
  return (bindings ?? [])
    .map((b) => ({ ad_account_id: b.ad_account_id as string, client_name: ((b.client_name as string | null) ?? "").trim() }))
    .filter((b) => b.client_name && /\bIVS\b/i.test(b.client_name));
}

interface CampaignRow {
  id: string;
  name?: string;
}
interface AdsetRow {
  id: string;
  name?: string;
  created_time?: string;
  targeting?: TargetingLike;
  campaign_id?: string;
  campaign?: { name?: string };
}
interface AdRow {
  id: string;
  name?: string;
  campaign?: { name?: string };
}

const ACTIVE_FILTER = (field: string) => JSON.stringify([{ field, operator: "IN", value: ["ACTIVE"] }]);

export async function scanAccountNames(token: string, acc: NamingAccount): Promise<NamingItem[]> {
  const act = acc.ad_account_id.startsWith("act_") ? acc.ad_account_id : `act_${acc.ad_account_id}`;
  const [campaigns, adsets, ads] = await Promise.all([
    metaGetAll<CampaignRow>(token, `/${act}/campaigns`, { fields: "id,name", limit: "500", filtering: ACTIVE_FILTER("campaign.effective_status") }),
    metaGetAll<AdsetRow>(token, `/${act}/adsets`, {
      fields: "id,name,created_time,targeting,campaign_id,campaign{name}",
      limit: "200",
      filtering: ACTIVE_FILTER("adset.effective_status"),
    }),
    metaGetAll<AdRow>(token, `/${act}/ads`, { fields: "id,name,campaign{name}", limit: "500", filtering: ACTIVE_FILTER("ad.effective_status") }),
  ]);

  const items: NamingItem[] = [];
  const push = (entity: NamingEntity, id: string, name: string, c: ReturnType<typeof checkAdName>) => {
    if (c.ok) return;
    items.push({
      entity,
      id,
      ad_account_id: acc.ad_account_id,
      client_name: acc.client_name,
      current_name: name,
      suggestion: c.suggestion,
      problems: c.problems,
      needsInput: c.needsInput,
      autoFix: c.autoFix,
    });
  };

  for (const c of campaigns) {
    const name = c.name ?? "";
    if (VAGA_RE.test(name)) continue;
    push("campaign", c.id, name, checkCampaignName(name, acc.client_name));
  }
  for (const a of adsets) {
    const name = a.name ?? "";
    if (VAGA_RE.test(a.campaign?.name ?? "")) continue;
    push("adset", a.id, name, checkAdsetName({ name, createdTime: a.created_time ?? null, targeting: a.targeting }));
  }
  for (const ad of ads) {
    const name = ad.name ?? "";
    if (VAGA_RE.test(ad.campaign?.name ?? "")) continue;
    push("ad", ad.id, name, checkAdName(name));
  }
  return items;
}

export async function scanAllNames(
  db: Db,
  userId: string,
  token: string,
  onlyAccountId?: string,
): Promise<{ items: NamingItem[]; failedAccounts: string[]; accounts: NamingAccount[] }> {
  let accounts = await namingAccounts(db, userId);
  if (onlyAccountId) accounts = accounts.filter((a) => a.ad_account_id === onlyAccountId);
  const items: NamingItem[] = [];
  const failedAccounts: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < accounts.length) {
      const acc = accounts[next++];
      try {
        items.push(...(await scanAccountNames(token, acc)));
      } catch (e) {
        console.error("naming scan err (non-fatal)", acc.ad_account_id, e);
        failedAccounts.push(acc.client_name);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));
  return { items, failedAccounts, accounts };
}

export async function renameEntity(token: string, id: string, name: string): Promise<void> {
  await metaPost(token, `/${id}`, { name });
}

export interface AutoFixResult {
  fixed: Array<{ id: string; from: string; to: string; client_name: string }>;
  failed: Array<{ id: string; error: string }>;
  failedAccounts: string[];
  sendError: string | null;
}

// Ajusta sozinho (sem aprovação) os conjuntos em que SÓ a idade e/ou a data divergem — os dois dados vêm direto da Meta.
export async function runNamingAutoFix(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean; deadlineMs?: number } = { send: false },
): Promise<AutoFixResult> {
  const deadline = opts.deadlineMs ?? Date.now() + 50_000;
  const { items, failedAccounts } = await scanAllNames(db, userId, token);
  const todo = items.filter((i) => i.autoFix && i.entity === "adset" && i.suggestion);
  const fixed: AutoFixResult["fixed"] = [];
  const failed: AutoFixResult["failed"] = [];
  for (const it of todo) {
    if (Date.now() + RENAME_DELAY_MS + 2000 > deadline) break;
    try {
      await renameEntity(token, it.id, it.suggestion!);
      fixed.push({ id: it.id, from: it.current_name, to: it.suggestion!, client_name: it.client_name });
    } catch (e) {
      failed.push({ id: it.id, error: (e as Error).message.slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, RENAME_DELAY_MS));
  }
  let sendError: string | null = null;
  if (opts.send && fixed.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "naming-fix",
        title: `✏️ Nomes ajustados (idade/data) em ${fixed.length} conjunto${fixed.length > 1 ? "s" : ""}`,
        body: fixed.map((f) => `• ${f.client_name}: ${f.from} → ${f.to}`).join("\n"),
        count: fixed.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { fixed, failed, failedAccounts, sendError };
}
