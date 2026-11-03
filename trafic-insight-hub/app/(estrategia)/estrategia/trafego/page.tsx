"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Acompanhamento } from "@/components/estrategia/acompanhamento";
import { Alertas, buildGroups, countAlerts, type AlertasServer, type NamingData } from "@/components/estrategia/alertas";
import { matchesResp, readCache, useCarteira, writeCache } from "@/components/estrategia/use-carteira";
import { Btn, hhmm } from "@/components/estrategia/ui";

// Etapa 238: Hub estratégico → Tráfego (Acompanhamento + Alertas).
export default function TrafegoPage() {
  const { ui } = useEstr();
  const { linhas, loading, error, at, reload } = useCarteira();
  const [tab, setTab] = useState<"acomp" | "alertas">("acomp");
  const [srv, setSrv] = useState<AlertasServer | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState<string | null>(null);
  const [naming, setNaming] = useState<NamingData>({ items: [], loading: false, error: null });
  const visible = useMemo(() => (linhas ?? []).filter((l) => matchesResp(ui.resp, l.responsible)), [linhas, ui.resp]);

  // Alertas do servidor: depois que a carteira carregou (precisa da lista de contas).
  const ids = useMemo(() => (linhas ?? []).map((l) => l.id).join(","), [linhas]);
  const loadAlertas = useCallback(async (accountIds: string[]) => {
    setSrvLoading(true);
    setSrvError(null);
    try {
      const d = await fetch("/api/estrategia/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setSrv(d as AlertasServer);
      writeCache("estr_alertas_v1", d);
    } catch (e) {
      setSrvError((e as Error).message);
    } finally {
      setSrvLoading(false);
    }
  }, []);
  const loadNaming = useCallback(async () => {
    setNaming((n) => ({ ...n, loading: true, error: null }));
    try {
      const d = await fetch("/api/naming/check", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setNaming({ items: d.items ?? [], loading: false, error: null });
      writeCache("estr_naming_v1", d.items ?? []);
    } catch (e) {
      setNaming({ items: [], loading: false, error: (e as Error).message });
    }
  }, []);

  // Etapa 247: alertas e nomes também ficam travados — ao abrir usa o que foi guardado; só o "Atualizar" busca de novo.
  useEffect(() => {
    if (!ids) return;
    const c = readCache<AlertasServer>("estr_alertas_v1");
    // Usa os guardados só se não forem mais velhos que a carteira (quando a carteira atualizou sozinha, atualiza junto).
    if (c && (at == null || c.at >= at - 120_000)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- alertas guardados neste navegador
      setSrv(c.data);
      return;
    }
    void loadAlertas(ids.split(","));
  }, [ids, loadAlertas, at]);
  useEffect(() => {
    if (!ids) return;
    const c = readCache<NamingData["items"]>("estr_naming_v1");
    if (c && (at == null || c.at >= at - 120_000)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nomes guardados neste navegador
      setNaming({ items: c.data, loading: false, error: null });
      return;
    }
    void loadNaming();
  }, [ids, loadNaming, at]);

  const alertCount = useMemo(() => countAlerts(buildGroups(visible, srv, naming)), [visible, srv, naming]);

  function refresh() {
    void reload();
    if (ids) void loadAlertas(ids.split(","));
    void loadNaming();
  }
  // "atualizado às 10:32" — se for de outro dia, mostra a data também (números travados podem ser de ontem).
  const atLabel = at
    ? new Date(at).toDateString() === new Date().toDateString()
      ? `atualizado às ${hhmm(at)}`
      : `atualizado em ${new Date(at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hhmm(at)} — clique em Atualizar`
    : "";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Tráfego"
        sub={tab === "acomp" ? `Visão das contas da carteira${atLabel ? ` · ${atLabel}` : ""}` : `Central de monitoramento e alertas${atLabel ? ` · ${atLabel}` : ""}`}
      >
        <Btn primary onClick={refresh} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </Btn>
      </PageHeader>

      <div className="px-4 lg:px-6">
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["acomp", "Acompanhamento"],
              ["alertas", "Alertas"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === k ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {label}
              {k === "alertas" && alertCount > 0 ? (
                <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white tabular-nums">{alertCount}</span>
              ) : null}
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
            linhas={visible}
            activities={srv?.activities ?? null}
            activitiesFailed={srv?.activitiesFailed ?? []}
          />
        ) : (
          <>
            {srvError ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">Alertas: {srvError}</div> : null}
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {srv ? `Alertas de saldo, erros e otimizações às ${hhmm(Date.parse(srv.at))}` : srvLoading ? "Buscando alertas…" : null}
              <Btn small onClick={() => void loadAlertas(ids.split(","))} disabled={srvLoading || !ids}>
                {srvLoading ? "Buscando…" : "Atualizar alertas"}
              </Btn>
            </div>
            <Alertas linhas={visible} srv={srv} naming={naming} loading={srvLoading} />
          </>
        )}
      </div>

    </div>
  );
}
