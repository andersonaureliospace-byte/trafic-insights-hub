"use client";

import Link from "next/link";
import { useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { cpaOf, cpaSortKey, calendarSP } from "@/lib/estrategia/calc";
import type { ActivityItem } from "@/lib/estrategia/activities";
import { Card, SEV_RANK, SevBadge, ago, fmtBRL, fmtCpa, type Sev } from "./ui";
import type { Linha } from "./use-carteira";

// Etapa 238: Tráfego → Alertas. Cada quadro lista as contas com aquele problema; o último quadro junta tudo por conta.

export interface AlertasServer {
  balance: Array<{ ad_account_id: string; balance: number; threshold: number }>;
  payment: Array<{ ad_account_id: string; reason: string | null }>;
  errors: Array<{ ad_account_id: string; entity_type: string; name: string | null; reasons: string[]; checked_at: string }>;
  location: Array<{ ad_account_id: string; name: string | null; reasons: string[]; expansionFixed: boolean; paused: boolean; checked_at: string }>;
  activities: Record<string, ActivityItem[]>;
  activitiesFailed: string[];
  warnings: string[];
  at: string;
}

export interface NamingIssue {
  id?: string; // id do objeto na Meta (pra renomear)
  client_name?: string | null;
  ad_account_id: string;
  entity: "campaign" | "adset" | "ad";
  current_name: string;
  problems: string[];
  suggestion: string | null;
  needsInput: boolean;
}
export interface NamingData {
  items: NamingIssue[];
  loading: boolean;
  error: string | null;
}

interface Item {
  id: string;
  name: string;
  detail: string;
  sev: Sev;
  naming?: boolean; // abre a lista do que está errado nos nomes dessa conta
}
interface Group {
  key: string;
  title: string;
  icon: string;
  items: Item[];
  foot: string;
  emptyText?: string;
}

// Etapa 249: erro que é só de espaço entre os caracteres (ex.: "35 - 64" × "35-64", "CHAPECÓ +" × "CHAPECÓ+") não conta.
const squash = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toUpperCase();
export function isSpacingOnly(it: NamingIssue): boolean {
  return !!it.suggestion && squash(it.suggestion) === squash(it.current_name);
}
export const relevantNaming = (items: NamingIssue[]) => items.filter((it) => !isSpacingOnly(it));
// Dá pra corrigir com um clique: tem sugestão completa (sem "?") e não precisa conferir nada.
export const canAutoFix = (it: NamingIssue) => !!it.id && !!it.suggestion && !it.suggestion.includes("?") && !it.needsInput;

// "LOCALIZAÇÃO fora do padrão" → "LOCALIZAÇÃO"; "Estrutura fora do padrão (5 partes, esperado 6)" → "Estrutura (partes faltando/sobrando)".
function shortProblem(p: string): string {
  if (/^Estrutura fora do padrão/.test(p)) return "Estrutura (partes faltando ou sobrando)";
  return p.replace(/ fora do padrão$/, "");
}

const ENTITY_LABEL: Record<NamingIssue["entity"], string> = { campaign: "Campanha", adset: "Conjunto", ad: "Criativo" };

// Explicação curta de cada erro, na língua do POP.
function explain(p: string): string | null {
  if (/cópia/i.test(p)) return 'Ao duplicar, a Meta põe "Cópia" no nome. Apague.';
  if (/\[VAGA\]/.test(p)) return "Campanha de vaga começa com [VAGA].";
  if (/^TIPO precisa/.test(p)) return "Começa com GERAL, EXAME ou PROMO.";
  if (/^TIPO "/.test(p)) return "Escreva o tipo exatamente como no padrão.";
  if (/^TIPO deve ser GERAL/.test(p)) return "Boleto é oferta do GERAL: GERAL | BOLETO | …";
  if (/^TIPO fora/.test(p)) return "Conjunto começa com GERAL, EXAME (com o valor junto: EXAME R$ 15,00) ou PROMO.";
  if (/^OBJETIVO/.test(p)) return "É o objetivo escolhido na campanha (ENGAJAMENTO, LEADS, VENDAS…), não o canal. Formulário = LEADS.";
  if (/^OFERTA fora/.test(p)) return "GERAL só leva BOLETO; PROMO leva a oferta com valor em R$ 15,00.";
  if (/precisa da oferta|precisa do valor/.test(p)) return "Escreva a oferta / o valor.";
  if (/^LOCALIZAÇÃO/.test(p) || /localização/.test(p)) return 'Com raio: só o km (8KM). Uma cidade: o nome. Várias: a primeira + "+" colado (AMPARO+).';
  if (/^IDADE/.test(p)) return "Idade igual à do público: 25-54. Até 65 ou mais: 18-65+.";
  if (/^GÊNERO/.test(p)) return "Só escreva MULHER ou HOMEM quando o público for de um gênero só.";
  if (/^PLATAFORMA/.test(p)) return "Só escreva INSTA ou FACE quando rodar em uma plataforma só.";
  if (/^DIRECIONAMENTO/.test(p)) return "INTERESSES só quando o conjunto tiver interesses.";
  if (/^RESPONSÁVEL/.test(p)) return "Identificação do gestor responsável pela conta, antes da data.";
  if (/^DATA/.test(p)) return "Dia/mês em que o conjunto começou a veicular: 01/11.";
  if (/^VDO PROPRIO/.test(p)) return "VDO PROPRIO só quando o vídeo é do cliente, depois da oferta.";
  if (/^Estrutura/.test(p)) return "Faltam ou sobram partes. Compare com o nome sugerido.";
  if (/Falta a UNIDADE|Faltam partes|Mais partes/.test(p)) return "Campanha: TIPO | OBJETIVO | UNIDADE.";
  if (/UNIDADE com data/.test(p)) return "A campanha não leva data.";
  if (/deduzido como PROMO/.test(p)) return "O nome não dizia o tipo. Confira se é PROMO mesmo.";
  if (/Criativo de EXAME/.test(p)) return "Valor do exame | data do primeiro uso | variação.";
  if (/Criativo leva/.test(p)) return "Use o nome do arquivo do vídeo/imagem.";
  return null;
}

// Etapa 249: renomeia na Meta pelo nome sugerido (mesma rota da aba Padrão de nomes). 3 por vez.
export async function renameIssues(items: NamingIssue[], onEach?: (it: NamingIssue, ok: boolean, error?: string) => void): Promise<string[]> {
  const done: string[] = [];
  const queue = items.filter(canAutoFix);
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        const d = (await fetch("/api/naming/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: it.id, name: it.suggestion, entity: it.entity, ad_account_id: it.ad_account_id, client_name: it.client_name ?? null }),
        }).then((r) => r.json())) as { ok?: boolean; error?: string };
        if (!d.ok) throw new Error(d.error ?? "Erro desconhecido");
        done.push(it.id as string);
        onEach?.(it, true);
      } catch (e) {
        onEach?.(it, false, (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return done;
}

export function NamingDetails({
  name,
  items,
  onClose,
  onFixed,
}: {
  name: string;
  items: NamingIssue[];
  onClose: () => void;
  onFixed?: (ids: string[]) => void;
}) {
  const order: NamingIssue["entity"][] = ["campaign", "adset", "ad"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.entity) - order.indexOf(b.entity));
  const [status, setStatus] = useState<Record<string, { busy?: boolean; error?: string }>>({});
  const [busyAll, setBusyAll] = useState(false);
  const fixable = sorted.filter(canAutoFix);
  async function fix(list: NamingIssue[]) {
    setStatus((s) => ({ ...s, ...Object.fromEntries(list.filter(canAutoFix).map((it) => [it.id as string, { busy: true }])) }));
    const ids = await renameIssues(list, (it, ok, error) =>
      setStatus((s) => ({ ...s, [it.id as string]: ok ? {} : { error } })),
    );
    if (ids.length) onFixed?.(ids);
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Nomes fora do padrão em ${name}`}
        className="flex h-full w-full max-w-2xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#10141c]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-5 dark:border-white/10">
          <div>
            <div className="text-base font-semibold">{name}</div>
            <div className="text-xs text-zinc-500">
              {items.length} {items.length === 1 ? "nome fora do padrão" : "nomes fora do padrão"} ·{" "}
              <Link href="/estrategia/pop/nomenclatura" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                ver o POP de nomenclatura
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {fixable.length ? (
              <button
                onClick={async () => {
                  setBusyAll(true);
                  await fix(fixable);
                  setBusyAll(false);
                }}
                disabled={busyAll}
                className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                title="Renomeia na Meta todos os que têm nome sugerido completo"
              >
                {busyAll ? "Corrigindo…" : `Corrigir todos (${fixable.length})`}
              </button>
            ) : null}
            <button onClick={onClose} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-white/10">Fechar</button>
          </div>
        </div>
        <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
          {sorted.map((it, i) => (
            <li key={i} className="flex flex-col gap-2 px-5 py-4">
              <span className="w-fit rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-zinc-600 uppercase dark:bg-white/10 dark:text-zinc-300">
                {ENTITY_LABEL[it.entity]}
              </span>
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">Está assim</div>
                <code className="block rounded-md bg-red-500/8 px-2 py-1.5 font-mono text-xs break-all text-red-800 dark:text-red-200">{it.current_name}</code>
              </div>
              {it.suggestion ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                      Deveria ficar{it.needsInput || it.suggestion.includes("?") ? " (confira antes de usar)" : ""}
                    </div>
                    {canAutoFix(it) ? (
                      <button
                        onClick={() => void fix([it])}
                        disabled={!!status[it.id as string]?.busy}
                        className="h-7 rounded-md border border-emerald-500 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                      >
                        {status[it.id as string]?.busy ? "Corrigindo…" : "Corrigir"}
                      </button>
                    ) : null}
                  </div>
                  <code className="block rounded-md bg-emerald-500/8 px-2 py-1.5 font-mono text-xs break-all text-emerald-800 dark:text-emerald-200">
                    {it.suggestion}
                  </code>
                  {status[it.id as string]?.error ? <p className="mt-1 text-xs text-red-600">Não corrigiu: {status[it.id as string]?.error}</p> : null}
                </div>
              ) : null}
              <ul className="flex flex-col gap-1">
                {it.problems.map((p, j) => {
                  const why = explain(p);
                  return (
                    <li key={j} className="text-xs">
                      <span className="font-semibold">✗ {p}</span>
                      {why ? <span className="text-zinc-500"> — {why}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Texto de "erro" que não é erro (status de revisão / conjunto sem anúncio): não aparece em Erros de veiculação.
const NOT_AN_ERROR = /em an[aá]lise|pending_review|in_process|pr[eé]-?aprovad|preapproved|sem an[uú]ncio ativo|campaign_paused|adset_paused/i;

// Dias sem nenhuma alteração na conta pra virar alerta em "Otimizações recentes".
const STALE_DAYS = 3;
// Regra do aviso do meio-dia (lib/alerts/cpa.ts): CPA de hoje mais de R$ 20 acima do ideal.
const MIDDAY_DIFF = 20;

export function buildGroups(linhas: Linha[], srv: AlertasServer | null, naming: NamingData): Group[] {
  const byId = new Map(linhas.map((l) => [l.id, l]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const cal = calendarSP();
  const groups: Group[] = [];

  // 1) Saldo e pagamento
  const saldo: Item[] = [];
  for (const p of srv?.payment ?? []) {
    if (!byId.has(p.ad_account_id)) continue;
    saldo.push({ id: p.ad_account_id, name: nameOf(p.ad_account_id), detail: p.reason ?? "Erro no pagamento", sev: "critico" });
  }
  for (const b of srv?.balance ?? []) {
    if (!byId.has(b.ad_account_id)) continue;
    saldo.push({
      id: b.ad_account_id,
      name: nameOf(b.ad_account_id),
      detail: `Saldo ${fmtBRL(b.balance)} (avisa abaixo de ${fmtBRL(b.threshold)})`,
      sev: b.balance <= 0 ? "critico" : "alta",
    });
  }
  groups.push({ key: "saldo", title: "Saldo baixo / erro de pagamento", icon: "💳", items: saldo, foot: "Mesma checagem do aviso automático de saldo" });

  // 2) CPA de hoje
  const cpaHoje: Item[] = [];
  for (const l of linhas) {
    if (!l.nums || l.cpaTarget == null || l.priority === "inauguracao") continue;
    const t = l.nums.periods.h;
    const cpa = cpaOf(t);
    if (cpa == null) continue;
    const over = cpa === Infinity ? t.spend - l.cpaTarget : cpa - l.cpaTarget;
    if (over <= MIDDAY_DIFF) continue;
    cpaHoje.push({
      id: l.id,
      name: l.name,
      detail: cpa === Infinity ? `${fmtBRL(t.spend)} gastos hoje sem conversa (ideal ${fmtBRL(l.cpaTarget)})` : `CPA hoje ${fmtCpa(cpa)} (ideal ${fmtBRL(l.cpaTarget)})`,
      sev: over > MIDDAY_DIFF + 10 ? "critico" : "alta",
    });
  }
  groups.push({
    key: "cpa",
    title: `CPA hoje mais de R$ ${MIDDAY_DIFF} acima do ideal`,
    icon: "⚠",
    items: cpaHoje,
    foot: "Mesma regra do aviso do meio-dia · contas em inauguração ficam de fora",
  });

  // 3) Investimento baixo — Etapa 249: pelo investimento diário ATUAL (orçamento do dia de tudo que está ligado) abaixo
  // da meta diária (meta mensal ÷ dias do mês), do menor pro maior. Não olha o ritmo.
  const investRows: Array<{ item: Item; budget: number }> = [];
  for (const l of linhas) {
    if (l.priority === "inauguracao" || l.dailyBudget == null) continue;
    const target = l.monthly != null && l.monthly > 0 ? l.monthly / cal.daysInMonth : null;
    if (target == null || l.dailyBudget >= target) continue;
    const pct = l.dailyBudget / target;
    investRows.push({
      budget: l.dailyBudget,
      item: {
        id: l.id,
        name: l.name,
        detail: `Investindo ${fmtBRL(l.dailyBudget)}/dia · meta ${fmtBRL(target)}/dia (faltam ${fmtBRL(target - l.dailyBudget)}/dia · ${Math.round(pct * 100)}%)`,
        sev: pct < 0.5 ? "alta" : "media",
      },
    });
  }
  investRows.sort((a, b) => a.budget - b.budget);
  groups.push({
    key: "invest",
    title: "Investimento baixo",
    icon: "↓",
    items: investRows.map((x) => x.item),
    foot: "Investimento diário atual abaixo da meta diária (meta mensal ÷ dias do mês) · do menor pro maior",
    emptyText: linhas.some((l) => l.dailyBudget === undefined) ? "Buscando o investimento diário…" : undefined,
  });

  // 4) Erros de veiculação, WhatsApp e região
  const errs = new Map<string, { sev: Sev; parts: string[] }>();
  const bump = (id: string, sev: Sev, part: string) => {
    if (!byId.has(id)) return;
    const cur = errs.get(id) ?? { sev: "baixa" as Sev, parts: [] };
    if (SEV_RANK[sev] > SEV_RANK[cur.sev]) cur.sev = sev;
    cur.parts.push(part);
    errs.set(id, cur);
  };
  let checkedAt: string | null = null;
  for (const e of srv?.errors ?? []) {
    if (!checkedAt || e.checked_at > checkedAt) checkedAt = e.checked_at;
    // Etapa 249: só erro de verdade — em análise, pré-aprovado e conjunto sem anúncio ativo ficam de fora.
    const real = e.reasons.filter((r) => !NOT_AN_ERROR.test(r));
    if (!real.length || e.entity_type === "adset" && /sem an[uú]ncio ativo/i.test(e.reasons.join(" "))) continue;
    const text = real.join(" · ");
    if (/whats/i.test(text)) bump(e.ad_account_id, "critico", `WhatsApp: ${e.name ?? ""}`.trim());
    else if (/reprovad|rejeitad|restri|problema|cobran|pagamento|disapprov|with_issues/i.test(text)) bump(e.ad_account_id, "alta", `${real[0]}${e.name ? ` (${e.name})` : ""}`);
    else bump(e.ad_account_id, "media", `${real[0]}${e.name ? ` (${e.name})` : ""}`);
  }
  for (const loc of srv?.location ?? []) {
    if (!checkedAt || loc.checked_at > checkedAt) checkedAt = loc.checked_at;
    const text = loc.reasons.join(" · ");
    if (/expans/i.test(text) && !/brasil/i.test(text)) {
      if (loc.expansionFixed) continue; // já foi desligada sozinha: não é erro pendente
      bump(loc.ad_account_id, "baixa", `Expansão de público${loc.name ? ` · ${loc.name}` : ""}`);
    } else {
      bump(loc.ad_account_id, "alta", `Região: ${loc.reasons[0] ?? "segmentação ampla"}${loc.paused ? " (pausado)" : ""}`);
    }
  }
  groups.push({
    key: "erros",
    title: "Erros de veiculação, WhatsApp e região",
    icon: "⛔",
    items: [...errs.entries()].map(([id, v]) => ({
      id,
      name: nameOf(id),
      detail: v.parts.length > 2 ? `${v.parts.slice(0, 2).join(" · ")} · +${v.parts.length - 2}` : v.parts.join(" · "),
      sev: v.sev,
    })),
    foot: checkedAt ? `Última verificação automática ${ago(checkedAt)}` : "Resultado das verificações automáticas",
  });

  // 5) Nomenclatura
  const nm = new Map<string, NamingIssue[]>();
  for (const it of relevantNaming(naming.items)) {
    const id = it.ad_account_id.replace(/^act_/, "");
    if (!byId.has(id)) continue;
    nm.set(id, [...(nm.get(id) ?? []), it]);
  }
  groups.push({
    key: "nomes",
    title: "Nomenclatura fora do padrão",
    icon: "🏷",
    items: [...nm.entries()].map(([id, list]) => {
      // Os erros que mais aparecem nessa conta (ex.: "TIPO fora do padrão ×3").
      const tally = new Map<string, number>();
      for (const it of list) for (const p of it.problems) tally.set(shortProblem(p), (tally.get(shortProblem(p)) ?? 0) + 1);
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
      return {
        id,
        name: nameOf(id),
        detail: `${list.length} ${list.length === 1 ? "nome" : "nomes"} · ${top.map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(" · ")}`,
        sev: "baixa" as Sev,
        naming: true,
      };
    }),
    foot: naming.loading ? "Verificando os nomes na Meta…" : naming.error ? `Não deu pra verificar: ${naming.error}` : "Campanhas, conjuntos e anúncios ligados · regra do POP de nomenclatura",
    emptyText: naming.loading ? "Verificando…" : undefined,
  });

  // 6) Otimizações recentes (últimas 24h) + contas paradas
  const recent: Item[] = [];
  const stale: Item[] = [];
  const now = Date.now();
  for (const l of linhas) {
    const all = srv?.activities[l.id];
    if (!all) continue;
    const acts = all.filter((a) => a.relevant); // Etapa 242: só otimização relevante
    const last = acts[0];
    if (last && now - Date.parse(last.time) < 24 * 3600_000) {
      const n24 = acts.filter((a) => now - Date.parse(a.time) < 24 * 3600_000).length;
      recent.push({
        id: l.id,
        name: l.name,
        detail: `${last.actor ? `${last.actor}: ` : ""}${last.what}${n24 > 1 ? ` · +${n24 - 1} nas últimas 24h` : ""} · ${ago(last.time)}`,
        sev: "info",
      });
    }
    const days = last ? (now - Date.parse(last.time)) / 86_400_000 : Infinity;
    if (days >= STALE_DAYS && l.priority !== "inauguracao") {
      stale.push({
        id: l.id,
        name: l.name,
        detail: last ? `Última otimização relevante ${ago(last.time)}` : "Nenhuma otimização relevante nos últimos 7 dias",
        sev: "media",
      });
    }
  }
  recent.sort((a, b) => a.detail.localeCompare(b.detail));
  groups.push({
    key: "otim",
    title: "Otimizações recentes",
    icon: "↻",
    items: [...stale, ...recent],
    foot: `Orçamento, liga/desliga, conjunto/anúncio novo, público, criativo ou lance · alerta com ${STALE_DAYS}+ dias sem otimização`,
  });

  return groups;
}

export function countAlerts(groups: Group[]): number {
  return groups.reduce((n, g) => n + g.items.filter((i) => i.sev !== "info").length, 0);
}

export function Alertas({
  linhas,
  srv,
  naming,
  loading,
  onNamingFixed,
}: {
  linhas: Linha[];
  srv: AlertasServer | null;
  naming: NamingData;
  loading: boolean;
  onNamingFixed?: (ids: string[]) => void;
}) {
  const groups = buildGroups(linhas, srv, naming);
  const [namingOpen, setNamingOpen] = useState<string | null>(null);
  const [fixingAll, setFixingAll] = useState<string | null>(null);
  const visibleIds = new Set(linhas.map((l) => l.id));
  const allFixable = relevantNaming(naming.items).filter((it) => canAutoFix(it) && visibleIds.has(it.ad_account_id.replace(/^act_/, "")));

  // Contas que precisam de atenção: soma dos alertas por conta (crítico vale mais).
  const score = new Map<string, { n: number; pts: number; top: Sev; titles: string[] }>();
  for (const g of groups) {
    for (const it of g.items) {
      if (it.sev === "info") continue;
      const cur = score.get(it.id) ?? { n: 0, pts: 0, top: "baixa" as Sev, titles: [] };
      cur.n++;
      cur.pts += SEV_RANK[it.sev] ** 2;
      if (SEV_RANK[it.sev] > SEV_RANK[cur.top]) cur.top = it.sev;
      cur.titles.push(g.title.split(" ")[0]);
      score.set(it.id, cur);
    }
  }
  const attention = [...score.entries()]
    .filter(([, v]) => v.n >= 2 || v.top === "critico")
    .sort((a, b) => b[1].pts - a[1].pts);
  const byId = new Map(linhas.map((l) => [l.id, l]));
  const worstCpa = linhas
    .filter((l) => l.nums && l.cpaTarget != null && l.priority !== "inauguracao")
    .map((l) => ({ l, cpa: cpaOf(l.nums!.periods.u3) }))
    .sort((a, b) => cpaSortKey(b.cpa, b.l.cpaTarget) - cpaSortKey(a.cpa, a.l.cpaTarget))[0];

  return (
    <div className="flex flex-col gap-4">
      {srv?.warnings?.length ? (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{srv.warnings.join(" · ")}</div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const n = g.items.filter((i) => i.sev !== "info").length;
          return (
            <Card key={g.key} className="flex min-w-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden>{g.icon}</span>
                  {g.title}
                </h3>
                {g.key === "nomes" && allFixable.length ? (
                  <button
                    onClick={async () => {
                      setFixingAll("…");
                      let n = 0;
                      const ids = await renameIssues(allFixable, () => setFixingAll(`${++n}/${allFixable.length}`));
                      setFixingAll(null);
                      if (ids.length) onNamingFixed?.(ids);
                    }}
                    disabled={!!fixingAll}
                    title="Renomeia na Meta todos os nomes com sugestão completa (de todas as contas da lista)"
                    className="ml-auto rounded-md border border-blue-500 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                  >
                    {fixingAll ? `Corrigindo ${fixingAll}` : `Corrigir todos (${allFixable.length})`}
                  </button>
                ) : null}
                <span
                  className={`min-w-6 rounded-md px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${
                    n > 0 ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {g.key === "otim" && n === 0 ? g.items.length : n}
                </span>
              </div>
              <ul className="max-h-72 flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
                {g.items.length === 0 ? (
                  <li className="px-4 py-3 text-xs text-zinc-500">{loading && !srv ? "Carregando…" : (g.emptyText ?? "Nada pra ver agora")}</li>
                ) : (
                  g.items.map((it, i) => (
                    <li key={`${it.id}-${i}`} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <a
                          href={adsManagerUrl(it.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                        >
                          {it.name}
                        </a>
                        <div className="text-xs break-words text-zinc-500">{it.detail}</div>
                        {it.naming ? (
                          <button
                            onClick={() => setNamingOpen(it.id)}
                            className="mt-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Ver o que está errado →
                          </button>
                        ) : null}
                      </div>
                      <SevBadge sev={it.sev} />
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-white/10">{g.foot}</div>
            </Card>
          );
        })}
      </div>

      <div className="rounded-xl bg-blue-600 p-5 text-white shadow-lg shadow-blue-900/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Contas que precisam de atenção hoje</h3>
            <p className="text-xs text-blue-100">Contas com 2 ou mais alertas, ou com algum alerta crítico — da mais grave pra menos grave</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums">{attention.length}</div>
            <div className="text-[11px] tracking-wide text-blue-100 uppercase">contas</div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention[0] ? (
            <div className="rounded-lg bg-white/12 p-3">
              <div className="text-[11px] tracking-wide text-blue-100 uppercase">Mais crítica</div>
              <div className="font-semibold">{byId.get(attention[0][0])?.name}</div>
              <div className="text-xs text-blue-100">{attention[0][1].n} alertas ativos</div>
            </div>
          ) : null}
          {worstCpa ? (
            <div className="rounded-lg bg-white/12 p-3">
              <div className="text-[11px] tracking-wide text-blue-100 uppercase">Pior CPA (últimos 3 dias)</div>
              <div className="font-semibold">{worstCpa.l.name}</div>
              <div className="text-xs text-blue-100">
                {fmtCpa(worstCpa.cpa)} · ideal {fmtBRL(worstCpa.l.cpaTarget)}
              </div>
            </div>
          ) : null}
        </div>
        {attention.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {attention.map(([id, v]) => (
              <li key={id} className="rounded-full bg-white/15 px-3 py-1 text-xs">
                <b>{byId.get(id)?.name ?? id}</b> · {v.n} {v.n === 1 ? "alerta" : "alertas"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-blue-100">Nenhuma conta com alerta crítico ou acumulado.</p>
        )}
      </div>
      {namingOpen ? (
        <NamingDetails
          name={byId.get(namingOpen)?.name ?? namingOpen}
          items={relevantNaming(naming.items).filter((x) => x.ad_account_id.replace(/^act_/, "") === namingOpen)}
          onClose={() => setNamingOpen(null)}
          onFixed={onNamingFixed}
        />
      ) : null}
    </div>
  );
}
