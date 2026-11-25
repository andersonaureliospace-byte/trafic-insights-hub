"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Acompanhamento } from "@/components/estrategia/acompanhamento";
import { CardsContas } from "@/components/estrategia/cards-contas";
import { AlertasQuadro, alertasDe, naGeladeira, useGeladeira } from "@/components/estrategia/alertas-quadro";
import type { AlertasServer } from "@/components/estrategia/alertas";
import { matchesResp, readCache, useCarteira, writeCache } from "@/components/estrategia/use-carteira";
import { Btn, hhmm } from "@/components/estrategia/ui";

// Etapa 238: Hub estratégico → Acompanhamento. Abas: Contas (o quadro), Ontem × hoje e Alertas (Etapa 341).
// Os Alertas saíram daqui e foram pra Configurações → Alertas; a aba "Sensíveis e críticas" virou o filtro "Só sensíveis".
const SENS_KEY = "estr_so_sensiveis";

// Atualização automática do quadro e aviso de números velhos (nov/2026).
const AUTO_REFRESH_MS = 30 * 60_000; // em horário comercial, atualiza sozinho a cada 30 min
const STALE_AVISO_MS = 60 * 60_000; // mais de 1 hora sem atualizar = faixa de aviso no topo
function fmtIdade(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
  const d = Math.floor(h / 24);
  return `${d} dia${d > 1 ? "s" : ""}`;
}

export default function TrafegoPage() {
  const { ui, role } = useEstr();
  const isGestor = role === "gestor"; // Etapa 352: gestor — sem a aba Alertas (nem a busca de saldo/pagamento)
  const { linhas, loading, error, at, reload, refreshFicha } = useCarteira();
  const [tab, setTab] = useState<"acomp" | "graficos" | "alertas">("acomp");
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
    if (!ids) return; // Etapa 354: gestor também busca (linha vermelha de saldo/pagamento das contas dele)
    const c = readCache<AlertasServer>("estr_alertas_v1");
    if (c && new Date(c.at).toDateString() === new Date().toDateString()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- alertas guardados neste navegador
      setSrv(c.data);
      return;
    }
    void loadAlertas(ids.split(","));
  }, [ids, loadAlertas]);

  // Etapa 324: otimizações (quem mexeu na conta e quando) — junto do Atualizar e ao abrir Ontem × hoje.
  const loadOtim = useCallback(async (accountIds: string[], force = false) => {
    if (accountIds.length === 0) return;
    try {
      const d = await fetch("/api/estrategia/otimizacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds, force }),
      }).then((r) => r.json());
      if (d.error) return;
      setSrv((cur0) => {
        // Etapa 352: gestor não busca os Alertas — a coluna Otimização nasce de um retrato vazio
        const cur: AlertasServer | null =
          cur0 ?? (isGestor ? { balance: [], payment: [], errors: [], location: [], activities: {}, activitiesFailed: [], warnings: [], at: new Date().toISOString() } : null);
        if (!cur) return cur;
        const next = { ...cur, activities: { ...cur.activities, ...(d.activities ?? {}) }, activitiesFailed: d.failed ?? [] };
        writeCache("estr_alertas_v1", next);
        return next;
      });
    } catch {
      /* fica com o que já tinha */
    }
  }, [isGestor]);

  // Etapa 350: force = clique no botão (número guardado de até 3 min); automático aceita até 15 min.
  function refresh(force = false) {
    void reload(force);
    if (ids) void loadOtim(ids.split(","), force);
    // Etapa 341: na aba Alertas, o saldo/pagamento/erros também entram no Atualizar
    if (tab === "alertas" && ids && !isGestor) void loadAlertas(ids.split(","));
  }

  // Etapa 341 → nov/2026: com a tela aberta e visível (qualquer aba), atualiza sozinha a cada 30 min, das 07h às 20h (Brasília).
  // Fora desse horário, ou se a aba ficou escondida, atualiza assim que voltar pra tela com os números de mais de 1 hora.
  // Custo: ~6 pedidos à Meta por conta a cada atualização (hoje + orçamento + otimização) — por conta de anúncio isso dá
  // ~12 por hora, bem longe do limite da Meta (que é por conta de anúncio).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  const [agora, setAgora] = useState(() => Date.now());
  const ultimaTentativa = useRef(0); // se a Meta falhar, não fica tentando a cada minuto
  useEffect(() => {
    const check = () => {
      setAgora(Date.now());
      if (loading || document.visibilityState !== "visible") return;
      const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date())) % 24;
      const idade = at == null ? Infinity : Date.now() - at;
      const outroDia = at != null && new Date(at).toDateString() !== new Date().toDateString();
      const comercial = h >= 7 && h < 20;
      if (Date.now() - ultimaTentativa.current < 10 * 60_000) return;
      if (outroDia || idade >= (comercial ? AUTO_REFRESH_MS : STALE_AVISO_MS)) {
        ultimaTentativa.current = Date.now();
        refreshRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- relógio da tela + atualização automática
    check();
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [at, loading]);
  const desatualizado = at != null && (agora - at >= STALE_AVISO_MS || new Date(at).toDateString() !== new Date(agora).toDateString());
  const geladeira = useGeladeira();
  const nAlertas = useMemo(
    () => visible.filter((l) => alertasDe(l, srv, undefined, at ?? 0).some((a) => !naGeladeira(geladeira.gel, l.id, a.key))).length,
    [visible, srv, at, geladeira.gel],
  );
  const atLabel = at
    ? new Date(at).toDateString() === new Date().toDateString()
      ? `atualizado às ${hhmm(at)}`
      : `atualizado em ${new Date(at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hhmm(at)} — clique em Atualizar`
    : "";

  return (
    <div className="flex flex-col">
      <PageHeader title="Acompanhamento" sub={`Visão das contas da carteira${atLabel ? ` · ${atLabel}` : ""}`}>
        <Btn primary onClick={() => refresh(true)} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </Btn>
      </PageHeader>

      {desatualizado && at != null ? (
        <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 lg:mx-6 dark:text-amber-300">
          <span>
            <b>Números desatualizados</b> — última atualização {new Date(at).toDateString() === new Date(agora).toDateString() ? `às ${hhmm(at)}` : `em ${new Date(at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hhmm(at)}`}
            {" "}(há {fmtIdade(agora - at)}). O atrasado/adiantado e o CPA podem não bater com a Meta.
          </span>
          <Btn primary onClick={() => refresh(true)} disabled={loading}>
            {loading ? "Atualizando…" : "Atualizar agora"}
          </Btn>
        </div>
      ) : null}

      <div className="px-4 lg:px-6">
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["acomp", "Contas"],
              ["graficos", "Ontem × hoje"],
              ["alertas", "Alertas"],
            ] as const
          ).filter(([k]) => !(isGestor && k === "alertas")).map(([k, label]) => (
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
              {k === "alertas" && nAlertas > 0 ? (
                <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 text-[11px] font-bold text-red-700 tabular-nums dark:text-red-300">{nAlertas}</span>
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
            linhas={linhasQuadro}
            activities={srv?.activities ?? null}
            activitiesFailed={srv?.activitiesFailed ?? []}
            pagamento={pagamento}
            onClienteSalvo={() => void refreshFicha()}
            soSensiveis={soSens}
            onSoSensiveis={trocarSoSens}
            nSensiveis={nSens}
            dataAt={at}
          />
        ) : tab === "graficos" ? (
          <CardsContas linhas={visible} isSens={isSens} loading={loading} activities={srv?.activities ?? null} />
        ) : (
          <AlertasQuadro linhas={visible} srv={srv} at={at} isSens={isSens} geladeira={geladeira} />
        )}
      </div>
    </div>
  );
}
