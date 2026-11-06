"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Card, Pill, ago } from "@/components/estrategia/ui";
import {
  AUDIT_PREF_KEY,
  CHECKS,
  DEFAULT_DIGEST_TIMES,
  estimatedCallsByHour,
  groupFor,
  isCheckOn,
  minuteToHHMM,
  normalizeConfig,
  type AuditConfig,
  type CheckId,
  type GroupRef,
} from "@/lib/estrategia/auditorias/config";

// Etapa 257: Automações → Auditorias. Liga/desliga cada conferência, escolhe pra qual grupo vai e os horários do resumo.
// Tudo que as conferências acham entra numa fila e sai junto, numa mensagem só por grupo, separada por gestor.

interface Run {
  slot: string;
  check_id: string;
  lot: string | null;
  accounts: number;
  meta_calls: number;
  found: number;
  error: string | null;
  ran_at: string;
}
interface Pending {
  id: string;
  check_id: string;
  client_name: string;
  responsible: string | null;
  line: string;
  group_name: string | null;
  created_at: string;
}

const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SLOTS = Array.from({ length: 96 }, (_, i) => minuteToHHMM(i * 15));
const nameOf = (id: string) => (id === "resumo" ? "Resumo enviado" : id === "custo_pausa" ? "Pausados (custo 3x)" : (CHECKS.find((c) => c.id === id)?.name ?? id));

function GroupPicker({
  value,
  groups,
  onLoad,
  onChange,
  allowDefault,
  defaultName,
}: {
  value: GroupRef | null | undefined;
  groups: GroupRef[] | null;
  onLoad: () => void;
  onChange: (g: GroupRef | null) => void;
  allowDefault?: boolean;
  defaultName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = flat(q);
    return (groups ?? []).filter((g) => !t || flat(g.name).includes(t)).slice(0, 80);
  }, [groups, q]);
  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          onLoad();
        }}
        className={`flex h-8 w-full max-w-[16rem] items-center gap-1.5 truncate rounded-lg border px-2.5 text-left text-xs ${
          value ? "border-zinc-300 dark:border-white/10" : allowDefault ? "border-dashed border-zinc-300 text-zinc-500 dark:border-white/15" : "border-amber-500/60 text-amber-700 dark:text-amber-300"
        }`}
      >
        <span className="truncate">{value ? `👥 ${value.name}` : allowDefault ? `Padrão${defaultName ? `: ${defaultName}` : " (sem grupo)"}` : "Escolher grupo…"}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#121722]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar grupo…"
            aria-label="Buscar grupo"
            className="mb-2 h-8 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
          />
          <div className="max-h-56 overflow-y-auto">
            {allowDefault ? (
              <button onClick={() => { onChange(null); setOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
                Usar o grupo padrão
              </button>
            ) : null}
            {groups == null ? (
              <p className="px-2 py-2 text-xs text-zinc-500">Carregando grupos…</p>
            ) : list.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-500">Nenhum grupo encontrado.</p>
            ) : (
              list.map((g) => (
                <button
                  key={g.id}
                  onClick={() => { onChange(g); setOpen(false); }}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-white/5 ${value?.id === g.id ? "font-semibold text-blue-600 dark:text-blue-400" : ""}`}
                >
                  {g.name}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AuditoriasConfig() {
  const [cfg, setCfg] = useState<AuditConfig | null>(null);
  const [groups, setGroups] = useState<GroupRef[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [accounts, setAccounts] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("09:00");
  const [sending, setSending] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const d = await fetch("/api/estrategia/auditorias", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setRuns(d.runs ?? []);
      setPending(d.pending ?? []);
      setAccounts(d.accounts ?? 0);
      setStatusErr(null);
    } catch (e) {
      setStatusErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const d = await fetch(`/api/estrategia/prefs?key=${AUDIT_PREF_KEY}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      setCfg(normalizeConfig(d?.value));
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o status ao abrir
    void loadStatus();
  }, [loadStatus]);

  const loadGroups = useCallback(() => {
    if (groups) return;
    fetch("/api/whatsapp/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => setGroups(((d.groups ?? []) as Array<{ id: string; name: string }>).map((g) => ({ id: g.id, name: g.name }))))
      .catch(() => setGroups([]));
  }, [groups]);

  async function save(next: AuditConfig) {
    setCfg(next);
    setSaving(true);
    setMsg(null);
    try {
      const d = await fetch("/api/estrategia/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: AUDIT_PREF_KEY, value: next }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setMsg({ ok: true, text: "Salvo." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const setCheck = (id: CheckId, patch: { on?: boolean; group?: GroupRef | null }) =>
    cfg && void save({ ...cfg, checks: { ...cfg.checks, [id]: { ...cfg.checks[id], ...patch } } });

  async function digestNow() {
    setSending(true);
    setMsg(null);
    try {
      const d = await fetch("/api/estrategia/auditorias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "digest-now" }) }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      const g = d.digest as { groups: number; items: number; noGroup: number; error: string | null } | null;
      if (g?.error) throw new Error(g.error);
      setMsg({ ok: true, text: g && g.items > 0 ? `Resumo enviado: ${g.items} itens em ${g.groups} grupo(s).` : "A fila está vazia — nada pra enviar." });
      await loadStatus();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  const perHour = useMemo(() => (cfg ? estimatedCallsByHour(Math.max(accounts, 1), (c) => isCheckOn(cfg, c)) : []), [cfg, accounts]);
  const maxHour = Math.max(1, ...perHour);
  const pendingByResp = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pending) m.set(p.responsible || "Sem responsável", (m.get(p.responsible || "Sem responsável") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pending]);
  const noGroup = cfg ? CHECKS.filter((c) => isCheckOn(cfg, c.id) && !groupFor(cfg, c.id)) : [];

  if (!cfg) return <Card className="p-5 text-sm text-zinc-500">Carregando auditorias…</Card>;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Auditorias</div>
            <div className="text-xs text-zinc-500">
              Uma agenda só, em lotes de 15 em 15 min, pra caber no limite da Meta com {accounts || "as"} contas. Os achados vão juntos no resumo, separados por gestor.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Grupo padrão</span>
            <GroupPicker value={cfg.defaultGroup} groups={groups} onLoad={loadGroups} onChange={(g) => void save({ ...cfg, defaultGroup: g })} />
          </div>
        </div>
        {statusErr ? <div className="mx-4 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{statusErr}</div> : null}
        {noGroup.length ? (
          <div className="mx-4 mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Sem grupo pra: {noGroup.map((c) => c.name).join(", ")}. Escolha o grupo padrão ou um grupo pra cada uma — senão os avisos ficam só na fila.
          </div>
        ) : null}
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {CHECKS.map((c) => {
            const on = isCheckOn(cfg, c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-72">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-zinc-500">{c.what}</div>
                  <div className="text-[11px] text-zinc-400">
                    {c.when} · {c.calls}
                  </div>
                </div>
                <GroupPicker
                  value={cfg.checks[c.id]?.group}
                  groups={groups}
                  onLoad={loadGroups}
                  onChange={(g) => setCheck(c.id, { group: g })}
                  allowDefault
                  defaultName={cfg.defaultGroup?.name}
                />
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? "Desligar" : "Ligar"} ${c.name}`}
                  onClick={() => setCheck(c.id, { on: !on })}
                  disabled={saving}
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-1 text-sm font-semibold">Horários do resumo</div>
          <p className="mb-3 text-xs text-zinc-500">Nesses horários vai uma mensagem por grupo com tudo que está na fila. Fila vazia = não manda nada.</p>
          <div className="flex flex-wrap gap-1.5">
            {cfg.digestTimes.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md bg-blue-600/10 px-2 py-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                {t.replace(":", "h")}
                <button aria-label={`Tirar ${t}`} onClick={() => void save({ ...cfg, digestTimes: cfg.digestTimes.filter((x) => x !== t) })} className="text-xs opacity-60 hover:opacity-100">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <select value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="Novo horário" className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]">
              {SLOTS.map((s) => (
                <option key={s} value={s}>{s.replace(":", "h")}</option>
              ))}
            </select>
            <Btn small onClick={() => void save({ ...cfg, digestTimes: [...new Set([...cfg.digestTimes, newTime])].sort() })}>+ Adicionar</Btn>
            <button onClick={() => void save({ ...cfg, digestTimes: DEFAULT_DIGEST_TIMES })} className="ml-auto text-xs text-zinc-500 hover:underline">
              Voltar ao padrão
            </button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold">Na fila pro próximo resumo ({pending.length})</span>
            <div className="flex gap-2">
              <Btn small onClick={() => void loadStatus()}>↻</Btn>
              <Btn small primary onClick={() => void digestNow()} disabled={sending || pending.length === 0}>{sending ? "Enviando…" : "Enviar resumo agora"}</Btn>
            </div>
          </div>
          {pending.length === 0 ? (
            <p className="text-xs text-zinc-500">Nada esperando. 🎉</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingByResp.map(([r, n]) => (
                  <Pill key={r} tone="info">{r}: {n}</Pill>
                ))}
              </div>
              <ul className="max-h-48 overflow-y-auto text-xs">
                {pending.slice(0, 60).map((p) => (
                  <li key={p.id} className="truncate border-b border-zinc-100 py-1 last:border-0 dark:border-white/5" title={p.line}>
                    <span className="text-zinc-500">{nameOf(p.check_id)} ·</span> <b>{p.client_name}</b> — {p.line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-1 text-sm font-semibold">Pedidos à Meta por hora (estimativa com {accounts || 1} contas)</div>
        <p className="mb-3 text-xs text-zinc-500">O limite do app é por hora. O pico fica perto de {maxHour} pedidos/hora — a folga é pras telas (botão Atualizar) e pras pausas.</p>
        <div className="flex h-24 items-end gap-[3px]">
          {perHour.map((v, h) => (
            <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}h: ~${v} pedidos`}>
              <div className={`w-full rounded-t ${v > 150 ? "bg-red-500" : v > 0 ? "bg-blue-600/70" : "bg-zinc-200 dark:bg-white/5"}`} style={{ height: `${Math.max(2, (v / maxHour) * 80)}px` }} />
              <span className="text-[9px] text-zinc-500 tabular-nums">{h}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Últimas rodadas</div>
        {runs.length === 0 ? (
          <p className="px-4 py-4 text-xs text-zinc-500">Nenhuma rodada ainda. Assim que o n8n começar a chamar (a cada 15 min), aparece aqui.</p>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="text-left text-[10px] tracking-wide text-zinc-500 uppercase">
                  <th className="px-4 py-2">Quando</th>
                  <th className="px-2 py-2">Conferência</th>
                  <th className="px-2 py-2">Lote</th>
                  <th className="px-2 py-2 text-right">Contas</th>
                  <th className="px-2 py-2 text-right">Pedidos</th>
                  <th className="px-2 py-2 text-right">Achados</th>
                  <th className="px-4 py-2">Erro</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100 dark:border-white/5">
                    <td className="px-4 py-1.5 whitespace-nowrap text-zinc-500" title={new Date(r.ran_at).toLocaleString("pt-BR")}>{r.slot.replace(":", "h")} · {ago(r.ran_at)}</td>
                    <td className="px-2 py-1.5">{nameOf(r.check_id)}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{r.lot ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.accounts}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.meta_calls}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.found}</td>
                    <td className="max-w-[16rem] truncate px-4 py-1.5 text-red-600 dark:text-red-400" title={r.error ?? ""}>{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {msg ? <div className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</div> : null}
    </div>
  );
}
