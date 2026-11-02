"use client";

import Link from "next/link";
import { useState } from "react";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";
import { RITMO_BAND, cpaOf, cpaSortKey, ritmoOf, calendarSP } from "@/lib/estrategia/calc";
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

// "LOCALIZAÇÃO fora do padrão" → "LOCALIZAÇÃO"; "Estrutura fora do padrão (5 partes, esperado 6)" → "Estrutura (partes faltando/sobrando)".
function shortProblem(p: string): string {
  if (/^Estrutura fora do padrão/.test(p)) return "Estrutura (partes faltando ou sobrando)";
  return p.replace(/ fora do padrão$/, "");
}

const ENTITY_LABEL: Record<NamingIssue["entity"], string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };

// Explicação curta de cada erro, na língua do POP.
function explain(p: string): string | null {
  if (/cópia/i.test(p)) return 'Ao duplicar, a Meta põe "Cópia" no nome. Apague.';
  if (/^TIPO precisa/.test(p)) return "A campanha começa com GERAL, EXAME ou OFERTA.";
  if (/^TIPO "/.test(p)) return "Escreva o tipo exatamente como no padrão.";
  if (/^TIPO deve ser GERAL/.test(p)) return "CREDIARIO/BOLETO vai depois do tipo: GERAL | CREDIARIO | …";
  if (/^TIPO fora/.test(p)) return "Conjunto começa com GERAL, EXAME ou PROMO.";
  if (/^OFERTA fora/.test(p)) return "GERAL não leva oferta; EXAME e PROMO levam (logo depois do tipo).";
  if (/precisa da oferta/.test(p)) return "Escreva a oferta logo depois do tipo.";
  if (/^LOCALIZAÇÃO/.test(p) || /localização/.test(p)) return "Com raio: só o km (8KM). Uma cidade: o nome. Várias: a primeira + \"+\" colado (AMPARO+).";
  if (/^IDADE/.test(p)) return "Idade igual à do público: 25-54. Até 65 ou mais: 18-65+.";
  if (/^GÊNERO/.test(p)) return "Só escreva MULHER ou HOMEM quando o público for de um gênero só.";
  if (/^PLATAFORMA/.test(p)) return "Só escreva INSTA ou FACE quando rodar em uma plataforma só.";
  if (/^DIRECIONAMENTO/.test(p)) return "INTERESSES só quando o conjunto tiver interesses.";
  if (/^AND/.test(p)) return "AND vem antes da data.";
  if (/^DATA/.test(p)) return "Data de criação do conjunto, dia/mês: 01/11.";
  if (/^PAGAMENTO/.test(p)) return "CREDIARIO ou BOLETO logo depois da oferta.";
  if (/^VDO PROPRIO/.test(p)) return "VDO PROPRIO depois da oferta/pagamento.";
  if (/^Estrutura/.test(p)) return "Faltam ou sobram partes. Compare com o nome sugerido.";
  if (/Falta a UNIDADE|Faltam partes|Mais partes/.test(p)) return "Campanha: TIPO | OBJETIVO | UNIDADE.";
  if (/UNIDADE com data/.test(p)) return "A campanha não leva data.";
  if (/deduzido como PROMO/.test(p)) return "O nome não dizia o tipo. Confira se é PROMO mesmo.";
  return null;
}

export function NamingDetails({ name, items, onClose }: { name: string; items: NamingIssue[]; onClose: () => void }) {
  const order: NamingIssue["entity"][] = ["campaign", "adset", "ad"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.entity) - order.indexOf(b.entity));
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
          <button onClick={onClose} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-white/10">Fechar</button>
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
                  <div className="text-[11px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                    Deveria ficar{it.needsInput ? " (troque o que está em letras de exemplo)" : ""}
                  </div>
                  <code className="block rounded-md bg-emerald-500/8 px-2 py-1.5 font-mono text-xs break-all text-emerald-800 dark:text-emerald-200">
                    {it.suggestion}
                  </code>
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

  // 3) Investimento baixo
  const invest: Item[] = [];
  for (const l of linhas) {
    if (!l.nums || l.priority === "inauguracao") continue;
    const r = ritmoOf(l.monthly, l.nums.untilYesterday, cal);
    if (r.gap == null || r.gap < RITMO_BAND) continue;
    invest.push({
      id: l.id,
      name: l.name,
      detail: `Faltam ${fmtBRL(r.gap)} pra ficar em dia · ritmo ${fmtBRL(r.avg)} de ${fmtBRL(r.dailyTarget)}/dia`,
      sev: l.monthly && r.gap >= l.monthly * 0.1 ? "alta" : "media",
    });
  }
  groups.push({ key: "invest", title: "Investimento baixo", icon: "↓", items: invest, foot: `Abaixo da meta até ontem em R$ ${RITMO_BAND} ou mais` });

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
    const text = e.reasons.join(" · ");
    if (/whats/i.test(text)) bump(e.ad_account_id, "critico", `WhatsApp: ${e.name ?? ""}`.trim());
    else if (/reprovad|restri|problema/i.test(text)) bump(e.ad_account_id, "alta", `${e.reasons[0]}${e.name ? ` (${e.name})` : ""}`);
    else if (e.entity_type === "adset") bump(e.ad_account_id, "media", `Conjunto sem anúncio ativo${e.name ? ` (${e.name})` : ""}`);
    else bump(e.ad_account_id, "baixa", `${e.reasons[0]}${e.name ? ` (${e.name})` : ""}`);
  }
  for (const loc of srv?.location ?? []) {
    if (!checkedAt || loc.checked_at > checkedAt) checkedAt = loc.checked_at;
    const text = loc.reasons.join(" · ");
    if (/expans/i.test(text) && !/brasil/i.test(text)) {
      bump(loc.ad_account_id, "baixa", `Expansão de público${loc.expansionFixed ? " (já desligada)" : ""}${loc.name ? ` · ${loc.name}` : ""}`);
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
  for (const it of naming.items) {
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
    const acts = srv?.activities[l.id];
    if (!acts) continue;
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
        detail: last ? `Sem nenhuma alteração ${ago(last.time)}` : "Sem nenhuma alteração nos últimos 7 dias",
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
    foot: `Histórico de atividades da Meta · alerta quando a conta fica ${STALE_DAYS}+ dias sem alteração`,
  });

  return groups;
}

export function countAlerts(groups: Group[]): number {
  return groups.reduce((n, g) => n + g.items.filter((i) => i.sev !== "info").length, 0);
}

export function Alertas({ linhas, srv, naming, loading }: { linhas: Linha[]; srv: AlertasServer | null; naming: NamingData; loading: boolean }) {
  const groups = buildGroups(linhas, srv, naming);
  const [namingOpen, setNamingOpen] = useState<string | null>(null);

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
          items={naming.items.filter((x) => x.ad_account_id.replace(/^act_/, "") === namingOpen)}
          onClose={() => setNamingOpen(null)}
        />
      ) : null}
    </div>
  );
}
