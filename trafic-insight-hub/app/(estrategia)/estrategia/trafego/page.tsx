"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Acompanhamento } from "@/components/estrategia/acompanhamento";
import { CardsContas } from "@/components/estrategia/cards-contas";
import type { AlertasServer } from "@/components/estrategia/alertas";
import { matchesResp, readCache, useCarteira, writeCache } from "@/components/estrategia/use-carteira";
import { Btn, hhmm } from "@/components/estrategia/ui";

// Etapa 238: Hub estratégico → Acompanhamento. Duas abas: Contas (o quadro) e Ontem × hoje.
// Os Alertas saíram daqui e foram pra Configurações → Alertas; a aba "Sensíveis e críticas" virou o filtro "Só sensíveis".
const SENS_KEY = "estr_so_sensiveis";

export default function TrafegoPage() {
  const { ui } = useEstr();
  const { linhas, loading, error, at, reload, refreshFicha } = useCarteira();
  const [tab, setTab] = useState<"acomp" | "graficos">("acomp");
  // Contas sensíveis (marcadas na ficha do cliente) e o filtro "Só sensíveis", lembrado neste navegador.
  const [sens, setSens] = useState<Record<string, boolean>>({});
  const [soSens, setSoSens] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filtro lembrado neste navegador
      if (window.localStorage.getItem(SENS_KEY) === "1") setSoSens(true);
    } catch {
      /* sem armazenamento */
    }
    fetch("/api/estrategia/prefs?key=contas_sensiveis", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSens(d?.value && typeof d.value === "object" ? (d.value as Record<string, boolean>) : {}))
      .catch(() => {});
  }, []);
  const trocarSoSens = (v: boolean) => {
    setSoSens(v);
    try {
      window.localStorage.setItem(SENS_KEY, v ? "1" : "0");
    } catch {
      /* só nesta sessão */
    }
  };
  const isSens = useCallback((id: string) => !!sens[id] || !!sens[id.replace(/^act_/, "")], [sens]);
  const visible = useMemo(() => (linhas ?? []).filter((l) => matchesResp(ui.resp, l.responsible)), [linhas, ui.resp]);
  const nSens = visible.filter((l) => isSens(l.id)).length;
  const linhasQuadro = useMemo(() => (soSens ? visible.filter((l) => isSens(l.id)) : visible), [soSens, visible, isSens]);

  // Saldo/pagamento (linha vermelha) e otimizações (coluna Otimização) vêm da mesma busca dos Alertas.
  const [srv, setSrv] = useState<AlertasServer | null>(null);
  const pagamento = useMemo(() => {
    const m: Record<string, string> = {};
    const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
    for (const b of srv?.balance ?? []) if (b.low && !b.handled) m[b.ad_account_id.replace(/^act_/, "")] = `Saldo baixo: ${brl(b.balance)}`;
    for (const p of srv?.payment ?? []) if (p.reason) m[p.ad_account_id.replace(/^act_/, "")] = `Pagamento: ${p.reason}`;
    return m;
  }, [srv]);

  const ids = useMemo(() => (linhas ?? []).map((l) => l.id).join(","), [linhas]);
  const loadAlertas = useCallback(async (accountIds: string[]) => {
    try {
      const d = await fetch("/api/estrategia/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds }),
      }).then((r) => r.json());
      if (d.error) return;
      setSrv(d as AlertasServer);
      writeCache("estr_alertas_v1", d);
    } catch {
      /* fica sem a linha vermelha até a próxima */
    }
  }, []);
  // Etapa 247/309: usa o que foi guardado hoje; buscar de novo só pelo "Atualizar alertas" (Configurações → Alertas).
  useEffect(() => {
    if (!ids) return;
    const c = readCache<AlertasServer>("estr_alertas_v1");
    if (c && new Date(c.at).toDateString() === new Date().toDateString()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- alertas guardados neste navegador
      setSrv(c.data);
      return;
    }
    void loadAlertas(ids.split(","));
  }, [ids, loadAlertas]);

  // Etapa 324: otimizações (quem mexeu na conta e quando) — junto do Atualizar e ao abrir Ontem × hoje.
  const loadOtim = useCallback(async (accountIds: string[]) => {
    if (accountIds.length === 0) return;
    try {
      const d = await fetch("/api/estrategia/otimizacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds }),
      }).then((r) => r.json());
      if (d.error) return;
      setSrv((cur) => {
        if (!cur) return cur;
        const next = { ...cur, activities: { ...cur.activities, ...(d.activities ?? {}) }, activitiesFailed: d.failed ?? [] };
        writeCache("estr_alertas_v1", next);
        return next;
      });
    } catch {
      /* fica com o que já tinha */
    }
  }, []);

  function refresh() {
    void reload();
    if (ids) void loadOtim(ids.split(","));
  }
  const atLabel = at
    ? new Date(at).toDateString() === new Date().toDateString()
      ? `atualizado às ${hhmm(at)}`
      : `atualizado em ${new Date(at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hhmm(at)} — clique em Atualizar`
    : "";

  return (
    <div className="flex flex-col">
      <PageHeader title="Acompanhamento" sub={`Visão das contas da carteira${atLabel ? ` · ${atLabel}` : ""}`}>
        <Btn primary onClick={refresh} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </Btn>
      </PageHeader>

      <div className="px-4 lg:px-6">
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["acomp", "Contas"],
              ["graficos", "Ontem × hoje"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                // Etapa 310: abrir "Ontem × hoje" já puxa as métricas de hoje
                if (k === "graficos" && tab !== "graficos" && !loading) {
                  void reload();
                  if (ids) void loadOtim(ids.split(","));
                }
              }}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === k ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 lg:p-6">
        {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">Erro ao carregar: {error}</div> : null}
        {linhas == null ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">
            Carregando as contas e os números do mês…
          </div>
        ) : tab === "acomp" ? (
          <Acompanhamento
            linhas={linhasQuadro}
            activities={srv?.activities ?? null}
            activitiesFailed={srv?.activitiesFailed ?? []}
            pagamento={pagamento}
            onClienteSalvo={() => void refreshFicha()}
            soSensiveis={soSens}
            onSoSensiveis={trocarSoSens}
            nSensiveis={nSens}
          />
        ) : (
          <CardsContas linhas={visible} isSens={isSens} loading={loading} activities={srv?.activities ?? null} />
        )}
      </div>
    </div>
  );
}
