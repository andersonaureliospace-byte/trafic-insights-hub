"use client";

import { useEffect, useState } from "react";
import { fmtCurrency } from "@/lib/format";

interface BalanceStatus {
  ad_account_id: string;
  client_name: string;
  balance: number;
  currency: string;
  threshold: number;
  low: boolean;
  alerted: boolean;
}

interface PaymentStatus {
  ad_account_id: string;
  client_name: string;
  reason: string | null;
  hasError: boolean;
  alerted: boolean;
}

export function AvisosTab() {
  const [statuses, setStatuses] = useState<BalanceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [paymentStatuses, setPaymentStatuses] = useState<PaymentStatus[] | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSendError, setPaymentSendError] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  async function load() {
    const res = await fetch("/api/alerts/balance");
    const d = await res.json();
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setSendError(d.sendError ?? null);
    setStatuses(d.statuses ?? []);
  }

  async function loadPayment() {
    const res = await fetch("/api/alerts/payment");
    const d = await res.json();
    if (d.error) {
      setPaymentError(d.error);
      return;
    }
    setPaymentError(null);
    setPaymentSendError(d.sendError ?? null);
    setPaymentStatuses(d.statuses ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos status de saldo e pagamento
    void load();
    void loadPayment();
  }, []);

  async function handleCheck() {
    setChecking(true);
    const res = await fetch("/api/alerts/balance", { method: "POST" });
    const d = await res.json();
    setChecking(false);
    if (d.error) {
      setError(d.error);
      return;
    }
    setError(null);
    setSendError(d.sendError ?? null);
    setStatuses(d.statuses ?? []);
    const alerted = (d.statuses ?? []).filter((s: BalanceStatus) => s.alerted).length;
    const low = (d.statuses ?? []).filter((s: BalanceStatus) => s.low).length;
    if (d.sendError) {
      alert(`Não deu pra enviar o aviso: ${d.sendError}`);
    } else if (alerted > 0) {
      alert(`Aviso enviado pro grupo — ${alerted} conta(s) com saldo baixo.`);
    } else if (low > 0) {
      alert(`${low} conta(s) com saldo baixo, mas já tinham sido avisadas nas últimas 24h.`);
    } else {
      alert("Nenhuma conta com saldo baixo agora.");
    }
  }

  async function handleCheckPayment() {
    setCheckingPayment(true);
    const res = await fetch("/api/alerts/payment", { method: "POST" });
    const d = await res.json();
    setCheckingPayment(false);
    if (d.error) {
      setPaymentError(d.error);
      return;
    }
    setPaymentError(null);
    setPaymentSendError(d.sendError ?? null);
    setPaymentStatuses(d.statuses ?? []);
    const alerted = (d.statuses ?? []).filter((s: PaymentStatus) => s.alerted).length;
    const withError = (d.statuses ?? []).filter((s: PaymentStatus) => s.hasError).length;
    if (d.sendError) {
      alert(`Não deu pra enviar o aviso: ${d.sendError}`);
    } else if (alerted > 0) {
      alert(`Aviso enviado pro grupo — ${alerted} conta(s) com erro no pagamento.`);
    } else if (withError > 0) {
      alert(`${withError} conta(s) com erro no pagamento, mas já tinham sido avisadas nas últimas 24h.`);
    } else {
      alert("Nenhuma conta com erro no pagamento agora.");
    }
  }

  const low = (statuses ?? []).filter((s) => s.low);
  const ok = (statuses ?? []).filter((s) => !s.low);

  const withError = (paymentStatuses ?? []).filter((s) => s.hasError);
  const paymentOk = (paymentStatuses ?? []).filter((s) => !s.hasError);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera contas pré-paga/híbrida com um limite definido (campo &quot;Alertar quando &lt;&quot; no
          Controle de Saldo/PIX do Painel — se ficar em branco, usa 20% do Valor base). O aviso vai pro
          grupo configurado em Configurações → WhatsApp.
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Saldo das contas</h3>
            <button
              onClick={() => void handleCheck()}
              disabled={checking}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {checking ? "Verificando…" : "Verificar agora"}
            </button>
          </div>

          {sendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {sendError}
            </p>
          ) : null}

          {error ? (
            <p className="px-4 py-6 text-sm text-red-600">{error}</p>
          ) : !statuses ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : statuses.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              Nenhuma conta pré-paga/híbrida com limite definido ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Saldo disponível</th>
                    <th className="px-4 py-2 text-right font-medium">Limite</th>
                  </tr>
                </thead>
                <tbody>
                  {[...low, ...ok].map((s) => (
                    <tr key={s.ad_account_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.client_name}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.low
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          }`}
                        >
                          {s.low ? "Saldo baixo" : "OK"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.balance, s.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.threshold, s.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera todas as contas vinculadas (Acompanhamento do Painel), olhando o status de pagamento
          direto da Meta (conta desabilitada, pagamento pendente, aguardando liquidação ou em período de
          carência). O aviso vai pro mesmo grupo configurado em Configurações → WhatsApp.
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Contas com erro no pagamento</h3>
            <button
              onClick={() => void handleCheckPayment()}
              disabled={checkingPayment}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {checkingPayment ? "Verificando…" : "Verificar agora"}
            </button>
          </div>

          {paymentSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {paymentSendError}
            </p>
          ) : null}

          {paymentError ? (
            <p className="px-4 py-6 text-sm text-red-600">{paymentError}</p>
          ) : !paymentStatuses ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : paymentStatuses.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta vinculada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...withError, ...paymentOk].map((s) => (
                    <tr key={s.ad_account_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.client_name}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.hasError
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          }`}
                        >
                          {s.hasError ? s.reason : "OK"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
