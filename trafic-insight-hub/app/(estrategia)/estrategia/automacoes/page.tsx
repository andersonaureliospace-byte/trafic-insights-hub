"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/estrategia/shell";
import { Card } from "@/components/estrategia/ui";
import { AUTOMATION_CATALOG } from "@/lib/automation-catalog";
import { DEFAULT_PAUSED, isEnabled, STANDBY_KEEP, SWITCHES_PREF_KEY, type Switches } from "@/lib/automation-switches-shared";
import { AuditoriasConfig } from "@/components/estrategia/auditorias-config";
import { OPERATIONAL_STANDBY } from "@/lib/estrategia/auditorias/config";

// Etapa 238: liga/pausa de cada automação. O n8n continua chamando no horário; pausada aqui, ela não faz nada.

interface Row {
  key: string;
  name: string;
  when: string;
  what: string;
}

const CPA_ROWS: Row[] = [
  { key: "cpa-alert:yesterday", name: "CPA acima da meta — 06h", when: "06h", what: "CPA de ontem mais de R$ 4 acima do ideal." },
  { key: "cpa-alert:midday", name: "CPA acima da meta — meio-dia", when: "12h", what: "CPA de hoje mais de R$ 20 acima do ideal." },
  { key: "cpa-alert:evening", name: "CPA acima da meta — 18h30", when: "18h30", what: "CPA de hoje mais de R$ 10 acima do ideal." },
];

const EXTRA: Array<Row & { group: string }> = [
  { group: "Pausas e orçamento", key: "creatives-no-result", name: "Criativos sem resultado", when: "junto da pausa de criativos", what: "Pausa criativos que gastaram sem conversa." },
  { group: "Avisos", key: "low-investment", name: "Investimento baixo (aviso antigo)", when: "seg a sex", what: "Avisa contas com investimento abaixo do Ritmo." },
  { group: "Retratos e sincronização", key: "cpa-board-cache", name: "Monitor de CPA (hub antigo)", when: "07h10", what: "Guarda os períodos fechados do Monitor de CPA." },
];

// Pausar estas pode deixar os Alertas e o Acompanhamento sem dados.
const FEEDS_HUB = new Set(["metrics-sync", "offers", "asana-descriptions", "funds-balance", "audit", "balance-alert"]);

export default function AutomacoesPage() {
  const [saved, setSaved] = useState<Switches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const d = await fetch(`/api/estrategia/prefs?key=${SWITCHES_PREF_KEY}`, { cache: "no-store" }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
        setSaved(d.value && typeof d.value === "object" ? (d.value as Switches) : {});
      } catch (e) {
        setError((e as Error).message);
        setSaved({});
      }
    })();
  }, []);

  const groups = useMemo(() => {
    const out = new Map<string, Row[]>();
    const seen = new Set<string>();
    for (const a of AUTOMATION_CATALOG) {
      const list = out.get(a.group) ?? [];
      if (a.id === "cpa-alert") {
        list.push(...CPA_ROWS);
      } else if (seen.has(a.id)) {
        // mesma automação em mais de uma rodada (ex.: Verificações): um botão só, os horários juntos
        const row = list.find((r) => r.key === a.id) ?? [...out.values()].flat().find((r) => r.key === a.id);
        if (row) row.when = `${row.when} · ${a.name}: ${a.when}`;
        continue;
      } else {
        list.push({ key: a.id, name: a.id === "audit" ? "Verificações (erros de veiculação e localização)" : a.name, when: a.when, what: a.what });
      }
      seen.add(a.id);
      out.set(a.group, list);
    }
    for (const x of EXTRA) out.set(x.group, [...(out.get(x.group) ?? []), x]);
    return [...out.entries()];
  }, []);

  async function toggle(key: string) {
    if (!saved) return;
    const next = { ...saved, [key]: !isEnabled(saved, key) };
    setBusy(key);
    setError(null);
    try {
      const d = await fetch("/api/estrategia/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SWITCHES_PREF_KEY, value: next }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const onCount = saved ? groups.flatMap(([, rows]) => rows).filter((r) => isEnabled(saved, r.key)).length : 0;
  const total = groups.flatMap(([, rows]) => rows).length;

  return (
    <div className="flex flex-col">
      <PageHeader noFilter title="Automações" sub="Auditorias do Hub estratégico · as automações antigas do Hub operacional ficam em standby" />
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        {/* Etapa 257 */}
        <AuditoriasConfig />
        <details className="rounded-xl border border-zinc-200 dark:border-white/10">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Automações antigas (Hub operacional) — {saved ? `${onCount} de ${total} ligadas` : "…"}
            {OPERATIONAL_STANDBY ? <span className="ml-2 text-xs font-normal text-zinc-500">em standby: só ficam as que alimentam o Hub (backup das métricas, saldo por fundos, ofertas da madrugada e Asana)</span> : null}
          </summary>
          <div className="flex flex-col gap-4 p-4 pt-0">
        {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {groups.map(([group, rows]) => (
          <Card key={group} className="overflow-hidden">
            <div className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">{group}</div>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {rows.map((r) => {
                const on = saved ? isEnabled(saved, r.key) : !DEFAULT_PAUSED.has(r.key);
                return (
                  <li key={r.key} className="flex items-start gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {r.name}
                        {FEEDS_HUB.has(r.key) ? <span className="ml-2 text-[11px] font-normal text-blue-600 dark:text-blue-400">usada pelo Hub estratégico</span> : null}
                      </div>
                      <div className="text-xs text-zinc-500">{r.what}</div>
                      <div className="text-[11px] text-zinc-400">{r.when}</div>
                    </div>
                    <button
                      role="switch"
                      aria-checked={on}
                      aria-label={`${on ? "Pausar" : "Ligar"} ${r.name}`}
                      disabled={!saved || busy === r.key || (OPERATIONAL_STANDBY && !STANDBY_KEEP.has(r.key))}
                      onClick={() => void toggle(r.key)}
                      className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50 ${
                        on ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className={`w-14 pt-0.5 text-xs font-medium ${on ? "text-blue-700 dark:text-blue-300" : "text-zinc-500"}`}>{on ? "Ligada" : "Pausada"}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
          </div>
        </details>
      </div>
    </div>
  );
}
