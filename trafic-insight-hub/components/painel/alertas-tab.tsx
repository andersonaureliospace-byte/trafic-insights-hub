"use client";

import { useCallback, useEffect, useState } from "react";

interface AlertNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  item_count: number;
  sent_to_group: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// Rótulo curto de cada tipo (o título completo vem da própria notificação).
const KIND_LABELS: Record<string, string> = {
  "creatives-pause": "Criativos pausados",
  "creatives-no-result": "Criativos sem resultado",
  "adsets-paused": "Conjuntos pausados",
  "adsets-cut": "Orçamento reduzido",
  "adsets-cut-failed": "Corte não aplicado",
  "low-budget": "Invest. diário ≤ 50% do Ritmo",
  "low-investment": "Investimento baixo",
  "cpa-yesterday": "CPA acima da meta",
  "bulk-status": "Status em massa",
  "balance-low": "Saldo baixo",
  "balance-friday": "Saldo de sexta",
  "payment-error": "Erro no pagamento",
  "manual-check": "Verificação manual",
};

// Cor da barrinha da esquerda: vermelho = o que também vai pro grupo (urgente); âmbar = o resto.
function accentClass(n: AlertNotification): string {
  return n.sent_to_group ? "border-l-red-500" : "border-l-amber-400";
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

function expiresIn(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "vencendo";
  const h = Math.ceil(mins / 60);
  return h >= 24 ? `some em ${Math.round(h / 24)} d` : `some em ${h} h`;
}

// Aba Alertas (Etapa 112) — todas as notificações das verificações automáticas. No grupo do
// WhatsApp vão só as urgentes; aqui aparece tudo. Some em 72h ou quando clica em OK.
export function AlertasTab({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [items, setItems] = useState<AlertNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todos" | "grupo" | "painel">("todos");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/alerts/notifications", { cache: "no-store" });
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      const list = (d.notifications ?? []) as AlertNotification[];
      setItems(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onCountChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os alertas assim que a aba monta
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function ok(id: string) {
    setItems((prev) => {
      const next = (prev ?? []).filter((n) => n.id !== id);
      onCountChange?.(next.length);
      return next;
    });
    await fetch(`/api/alerts/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function okAll() {
    if (!confirm("Dar OK em todos os alertas? Eles serão apagados.")) return;
    setItems([]);
    onCountChange?.(0);
    await fetch("/api/alerts/notifications?all=1", { method: "DELETE" });
  }

  const shown = (items ?? []).filter((n) => (filter === "todos" ? true : filter === "grupo" ? n.sent_to_group : !n.sent_to_group));

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Alertas</h2>
          {(["todos", "grupo", "painel"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-7 rounded-full px-2.5 text-xs font-medium ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {f === "todos" ? "Todos" : f === "grupo" ? "Urgentes (foram pro grupo)" : "Só aqui"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
          >
            ↻ Atualizar
          </button>
          <button
            onClick={() => void okAll()}
            disabled={!items || items.length === 0}
            className="h-8 rounded-md bg-zinc-900 px-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            OK em todos
          </button>
        </div>
      </div>

      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Aqui aparecem todas as notificações das verificações automáticas. No grupo do WhatsApp vão só as urgentes
        (CPA acima da meta, Invest. diário em 50% do Ritmo, saldo baixo, saldo de sexta e erro no pagamento). Cada
        alerta some sozinho em 72 horas ou quando você clica em OK.
      </p>

      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {items === null && !error ? <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p> : null}
      {items !== null && shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">Nenhum alerta aberto. Tudo certo por aqui.</p>
      ) : null}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {shown.map((n) => (
          <li key={n.id} className={`border-l-4 px-4 py-3 ${accentClass(n)}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {KIND_LABELS[n.kind] ?? n.kind}
                  </span>
                  {n.sent_to_group ? (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      enviado ao grupo
                    </span>
                  ) : null}
                  <span>{ago(n.updated_at)}</span>
                  <span>· {expiresIn(n.expires_at)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{n.title}</p>
                {n.body ? (
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-700 dark:text-zinc-300">{n.body}</pre>
                ) : null}
              </div>
              <button
                onClick={() => void ok(n.id)}
                className="h-8 shrink-0 rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                OK
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
