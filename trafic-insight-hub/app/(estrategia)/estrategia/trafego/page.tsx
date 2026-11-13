"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Acompanhamento } from "@/components/estrategia/acompanhamento";
import { CardsContas } from "@/components/estrategia/cards-contas";
import { Alertas, buildGroups, countAlerts, type AlertasServer, type NamingData } from "@/components/estrategia/alertas";
import { matchesResp, readCache, useCarteira, writeCache } from "@/components/estrategia/use-carteira";
import { Btn, hhmm } from "@/components/estrategia/ui";

// Etapa 238: Hub estratégico → Tráfego (Acompanhamento + Alertas).
export default function TrafegoPage() {
  const { ui } = useEstr();
  const { linhas, loading, error, at, reload, refreshFicha } = useCarteira();
  const [tab, setTab] = useState<"acomp" | "foco" | "alertas" | "graficos">("acomp");
  // Etapa 277: aba "Sensíveis e críticas" — só as contas que pedem atenção (marcadas como sensíveis na ficha e/ou com
  // prioridade Crítica). O filtro escolhido fica guardado neste navegador.
  const [foco, setFoco] = useState<"ambas" | "sensiveis" | "criticas">("ambas");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("estr_foco_filtro");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filtro lembrado neste navegador
      if (v === "sensiveis" || v === "criticas") setFoco(v);
    } catch {
      /* sem armazenamento */
    }
  }, []);
  const [sens, setSens] = useState<Record<string, boolean>>({});
  useEffect(() => {
    fetch("/api/estrategia/prefs?key=contas_sensiveis", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSens(d?.value && typeof d.value === "object" ? (d.value as Record<string, boolean>) : {}))
      .catch(() => {});
  }, []);
  const escolherFoco = (v: "ambas" | "sensiveis" | "criticas") => {
    setFoco(v);
    try {
      window.localStorage.setItem("estr_foco_filtro", v);
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };
  const [srv, setSrv] = useState<AlertasServer | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState<string | null>(null);
  const [naming, setNaming] = useState<NamingData>({ items: [], loading: false, error: null });
  const visible = useMemo(() => (linhas ?? []).filter((l) => matchesResp(ui.resp, l.responsible)), [linhas, ui.resp]);
  const isSens = useCallback((id: string) => !!sens[id] || !!sens[id.replace(/^act_/, "")], [sens]);
  const focoLinhas = useMemo(
    () =>
      visible.filter((l) => {
        const s = isSens(l.id);
        const c = l.priority === "critica";
        return foco === "sensiveis" ? s : foco === "criticas" ? c : s || c;
      }),
    [visible, foco, isSens],
  );
  const nSens = visible.filter((l) => isSens(l.id)).length;
  // Etapa 284: erro de pagamento ou saldo abaixo do limite → a linha fica vermelha no Acompanhamento
  const pagamento = useMemo(() => {
    const m: Record<string, string> = {};
    const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
    for (const b of srv?.balance ?? []) if (b.low && !b.handled) m[b.ad_account_id.replace(/^act_/, "")] = `Saldo baixo: ${brl(b.balance)}`;
    for (const p of srv?.payment ?? []) if (p.reason) m[p.ad_account_id.replace(/^act_/, "")] = `Pagamento: ${p.reason}`;
    return m;
  }, [srv]);
  const nCrit = visible.filter((l) => l.priority === "critica").length;

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

  // Etapa 247/309: alertas e nomes ficam travados — usa o que foi guardado hoje; buscar de novo só pelo "Atualizar alertas".
  useEffect(() => {
    if (!ids) return;
    const c = readCache<AlertasServer>("estr_alertas_v1");
    // Etapa 309: usa os guardados (de hoje); não busca de novo só porque a carteira atualizou.
    if (c && new Date(c.at).toDateString() === new Date().toDateString()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- alertas guardados neste navegador
      setSrv(c.data);
      return;
    }
    void loadAlertas(ids.split(","));
  }, [ids, loadAlertas]);
  // Etapa 309: nomenclatura (3 pedidos por conta) só quando abre a aba Alertas, 1x por dia.
  useEffect(() => {
    if (!ids || tab !== "alertas") return;
    const c = readCache<NamingData["items"]>("estr_naming_v1");
    if (c && new Date(c.at).toDateString() === new Date().toDateString()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nomes guardados neste navegador
      setNaming({ items: c.data, loading: false, error: null });
      return;
    }
    void loadNaming();
  }, [ids, loadNaming, tab]);

  const alertCount = useMemo(() => countAlerts(buildGroups(visible, srv, naming)), [visible, srv, naming]);

  // Etapa 309: Atualizar = só as métricas de hoje. Alertas têm o próprio botão ("Atualizar alertas").
  function refresh() {
    void reload();
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
        title="Acompanhamento"
        sub={tab === "acomp" || tab === "graficos" ? `Visão das contas da carteira${atLabel ? ` · ${atLabel}` : ""}` : `Central de monitoramento e alertas${atLabel ? ` · ${atLabel}` : ""}`}
      >
        <Btn primary onClick={refresh} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </Btn>
      </PageHeader>

      <div className="px-4 lg:px-6">
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["acomp", "Todas as contas"],
              ["foco", "Sensíveis e críticas"],
              ["alertas", "Alertas"],
              ["graficos", "Ontem × hoje"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                // Etapa 310: abrir "Ontem × hoje" já puxa as métricas de hoje (mesmo Atualizar, a ordem acompanha)
                if (k === "graficos" && tab !== "graficos" && !loading) void reload();
              }}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === k ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {label}
              {k === "foco" && linhas != null ? (
                <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] leading-none font-bold text-orange-700 tabular-nums dark:text-orange-300">
                  {visible.filter((l) => isSens(l.id) || l.priority === "critica").length}
                </span>
              ) : null}
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
        ) : tab === "foco" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["ambas", `Sensíveis e críticas · ${visible.filter((l) => isSens(l.id) || l.priority === "critica").length}`],
                  ["sensiveis", `Só sensíveis · ${nSens}`],
                  ["criticas", `Só críticas · ${nCrit}`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => escolherFoco(k)}
                  aria-pressed={foco === k}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    foco === k ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-zinc-500">Sensível: marque na ficha do cliente (📝). Crítica: prioridade do Asana.</span>
            </div>
            {focoLinhas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">
                {foco === "sensiveis" && nSens === 0 ? "Nenhuma conta marcada como sensível. Marque na ficha do cliente (📝 na linha) → Conta sensível." : "Nenhuma conta nesse filtro."}
              </div>
            ) : (
              <Acompanhamento linhas={focoLinhas} activities={srv?.activities ?? null} activitiesFailed={srv?.activitiesFailed ?? []} pagamento={pagamento} onClienteSalvo={() => void refreshFicha()} />
            )}
          </>
        ) : tab === "acomp" ? (
          <Acompanhamento
            linhas={visible}
            activities={srv?.activities ?? null}
            activitiesFailed={srv?.activitiesFailed ?? []}
            pagamento={pagamento}
            onClienteSalvo={() => void refreshFicha()}
          />
        ) : tab === "graficos" ? (
          <CardsContas linhas={visible} isSens={isSens} loading={loading} />
        ) : (
          <>
            {srvError ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">Alertas: {srvError}</div> : null}
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {srv ? `Alertas de saldo, erros e otimizações às ${hhmm(Date.parse(srv.at))}` : srvLoading ? "Buscando alertas…" : null}
              <Btn
                small
                onClick={() => {
                  void loadAlertas(ids.split(","));
                  void loadNaming();
                }}
                disabled={srvLoading || !ids}
              >
                {srvLoading ? "Buscando…" : "Atualizar alertas"}
              </Btn>
            </div>
            <Alertas
              linhas={visible}
              srv={srv}
              naming={naming}
              loading={srvLoading}
              onSaldoChanged={() => void loadAlertas(ids.split(","))}
              onNamingFixed={(fixed) =>
                setNaming((n) => {
                  const done = new Set(fixed);
                  const items = n.items.filter((it) => !(it.id && done.has(it.id)));
                  writeCache("estr_naming_v1", items);
                  return { ...n, items };
                })
              }
            />
          </>
        )}
      </div>

    </div>
  );
}
