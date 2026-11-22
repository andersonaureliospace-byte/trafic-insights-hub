"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Alertas, type AlertasServer } from "@/components/estrategia/alertas";
import { matchesResp, readCache, useCarteira, writeCache } from "@/components/estrategia/use-carteira";
import { Btn, Card, hhmm } from "@/components/estrategia/ui";
import { ConfigSaldoPainel } from "@/components/estrategia/config-saldo";

// Etapa 340/341: Configurações → Cobranças (antes "Alertas"). Saldo das contas à esquerda e, à direita, o painel com a
// configuração de saldo da conta clicada. Usa os mesmos dados guardados do dia que o Acompanhamento; buscar de novo só pelo "Atualizar".
export default function CobrancasPage() {
  const { ui } = useEstr();
  const { linhas } = useCarteira();
  const [srv, setSrv] = useState<AlertasServer | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState<string | null>(null);
  const [conta, setConta] = useState<string | null>(null); // conta aberta no painel da direita
  const visible = useMemo(() => (linhas ?? []).filter((l) => matchesResp(ui.resp, l.responsible)), [linhas, ui.resp]);
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

  useEffect(() => {
    if (!ids) return;
    const c = readCache<AlertasServer>("estr_alertas_v1");
    if (c && new Date(c.at).toDateString() === new Date().toDateString()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dados guardados neste navegador
      setSrv(c.data);
    } else void loadAlertas(ids.split(","));
  }, [ids, loadAlertas]);

  return (
    <div className="flex flex-col">
      <PageHeader title="Cobranças" sub={srv ? `Saldo e pagamento das contas · buscado às ${hhmm(Date.parse(srv.at))}` : "Saldo e pagamento das contas"}>
        <Btn primary onClick={() => void loadAlertas(ids.split(","))} disabled={srvLoading || !ids}>
          {srvLoading ? "Buscando…" : "Atualizar"}
        </Btn>
      </PageHeader>
      <div className="flex flex-col gap-3 p-4 lg:p-6">
        {srvError ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{srvError}</div> : null}
        {linhas == null ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">Carregando as contas…</div>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Alertas
              linhas={visible}
              srv={srv}
              naming={{ items: [], loading: false, error: null }}
              loading={srvLoading}
              soSaldo
              onPick={setConta}
              pickedId={conta}
              onSaldoChanged={() => void loadAlertas(ids.split(","))}
            />
            <Card className="p-5 xl:sticky xl:top-16">
              <ConfigSaldoPainel linhas={visible} selectedId={conta ?? visible[0]?.id ?? null} onSelect={setConta} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
