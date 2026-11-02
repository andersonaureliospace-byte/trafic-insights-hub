"use client";

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

export interface NamingData {
  items: Array<{ ad_account_id: string; current_name: string; problems: string[] }>;
  loading: boolean;
  error: string | null;
}

interface Item {
  id: string;
  name: string;
  detail: string;
  sev: Sev;
}
interface Group {
  key: string;
  title: string;
  icon: string;
  items: Item[];
  foot: string;
  emptyText?: string;
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
  const nm = new Map<string, string[]>();
  for (const it of naming.items) {
    const id = it.ad_account_id.replace(/^act_/, "");
    if (!byId.has(id)) continue;
    nm.set(id, [...(nm.get(id) ?? []), it.current_name]);
  }
  groups.push({
    key: "nomes",
    title: "Nomenclatura fora do padrão",
    icon: "🏷",
    items: [...nm.entries()].map(([id, names]) => ({
      id,
      name: nameOf(id),
      detail: `${names.length} ${names.length === 1 ? "nome" : "nomes"} · "${names[0]}"`,
      sev: "baixa" as Sev,
    })),
    foot: naming.loading ? "Verificando os nomes na Meta…" : naming.error ? `Não deu pra verificar: ${naming.error}` : "Padrão de nomes das contas IVS",
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
    </div>
  );
}
