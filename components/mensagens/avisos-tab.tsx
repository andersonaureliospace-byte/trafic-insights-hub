"use client";

import { useEffect, useState } from "react";
import { fmtCurrency } from "@/lib/format";
import { usePriorityOptions } from "@/lib/priority-context";

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

interface CpaStatus {
  ad_account_id: string;
  client_name: string;
  cpa_target: number;
  cpa_yesterday: number | null;
  diff: number | null;
  critical: boolean;
}

interface PausedCreative {
  ad_account_id: string;
  client_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  cost_per_conversation: number | null;
  ok: boolean;
  error?: string;
}

interface PausedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  cost_per_conversation: number | null;
  has_active_ad: boolean;
  ok: boolean;
  error?: string;
}

interface IncreasedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  ok: boolean;
  new_daily_budget?: number;
  error?: string;
}

interface LowInvestmentStatus {
  ad_account_id: string;
  client_name: string;
  daily_budget: number;
  ritmo: number;
  diff: number;
  low: boolean;
}

interface BulkStatusResult {
  accountId: string;
  clientName: string;
  outcome: "updated" | "unchanged" | "skipped";
  from?: string | null;
  to?: string | null;
  reason?: string;
}

export function AvisosTab() {
  const { options: priorityOptions } = usePriorityOptions();
  function priorityLabel(id?: string | null) {
    return priorityOptions.find((p) => p.id === id)?.label ?? "—";
  }
  const [statuses, setStatuses] = useState<BalanceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [paymentStatuses, setPaymentStatuses] = useState<PaymentStatus[] | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSendError, setPaymentSendError] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  const [cpaStatuses, setCpaStatuses] = useState<CpaStatus[] | null>(null);
  const [cpaError, setCpaError] = useState<string | null>(null);
  const [cpaSendError, setCpaSendError] = useState<string | null>(null);
  const [checkingCpa, setCheckingCpa] = useState(false);

  // Etapa 53: os 3 novos checks abaixo (Criativos/Conjuntos/Orçamento) NÃO
  // carregam nada sozinhos ao abrir a aba — o próprio "check" já pausa ou
  // aumenta orçamento de verdade, então só rodam quando o usuário clica no
  // botão (mesmo espírito de Auditoria > Erros de veiculação). Só o de
  // Investimento baixo (que nunca muda nada, só avisa) carrega como os
  // outros 3 de cima.
  const [pausedCreatives, setPausedCreatives] = useState<PausedCreative[] | null>(null);
  const [creativesPauseError, setCreativesPauseError] = useState<string | null>(null);
  const [creativesSendError, setCreativesSendError] = useState<string | null>(null);
  const [runningCreativesPause, setRunningCreativesPause] = useState(false);

  const [pausedAdSets, setPausedAdSets] = useState<PausedAdSet[] | null>(null);
  const [adsetsPauseError, setAdsetsPauseError] = useState<string | null>(null);
  const [adsetsSendError, setAdsetsSendError] = useState<string | null>(null);
  const [runningAdSetsPause, setRunningAdSetsPause] = useState(false);

  const [increasedAdSets, setIncreasedAdSets] = useState<IncreasedAdSet[] | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSendError, setBudgetSendError] = useState<string | null>(null);
  const [runningBudgetIncrease, setRunningBudgetIncrease] = useState(false);

  const [lowInvestmentStatuses, setLowInvestmentStatuses] = useState<LowInvestmentStatus[] | null>(null);
  const [lowInvestmentError, setLowInvestmentError] = useState<string | null>(null);
  const [lowInvestmentSendError, setLowInvestmentSendError] = useState<string | null>(null);
  const [checkingLowInvestment, setCheckingLowInvestment] = useState(false);

  // Etapa 55: mesma regra dos 3 checks de cima que já escrevem de verdade
  // (Criativos/Conjuntos/Orçamento) — não carrega nada sozinho ao abrir a
  // aba, já que o "check" aqui também escreve o status e reordena o quadro.
  const [bulkStatusResults, setBulkStatusResults] = useState<BulkStatusResult[] | null>(null);
  const [bulkStatusError, setBulkStatusError] = useState<string | null>(null);
  const [bulkStatusSendError, setBulkStatusSendError] = useState<string | null>(null);
  const [runningBulkStatus, setRunningBulkStatus] = useState(false);

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

  async function loadCpa() {
    const res = await fetch("/api/alerts/cpa");
    const d = await res.json();
    if (d.error) {
      setCpaError(d.error);
      return;
    }
    setCpaError(null);
    setCpaSendError(d.sendError ?? null);
    setCpaStatuses(d.statuses ?? []);
  }

  async function loadLowInvestment() {
    const res = await fetch("/api/alerts/low-investment");
    const d = await res.json();
    if (d.error) {
      setLowInvestmentError(d.error);
      return;
    }
    setLowInvestmentError(null);
    setLowInvestmentSendError(d.sendError ?? null);
    setLowInvestmentStatuses(d.statuses ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos status de saldo, pagamento, CPA e investimento baixo
    void load();
    void loadPayment();
    void loadCpa();
    void loadLowInvestment();
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

  async function handleCheckCpa() {
    setCheckingCpa(true);
    const res = await fetch("/api/alerts/cpa", { method: "POST" });
    const d = await res.json();
    setCheckingCpa(false);
    if (d.error) {
      setCpaError(d.error);
      return;
    }
    setCpaError(null);
    setCpaSendError(d.sendError ?? null);
    setCpaStatuses(d.statuses ?? []);
    const critical = (d.statuses ?? []).filter((s: CpaStatus) => s.critical).length;
    if (d.sendError) {
      alert(`Não deu pra enviar o aviso: ${d.sendError}`);
    } else if (critical > 0) {
      alert(`Aviso enviado pro grupo — ${critical} conta(s) com CPA acima da meta ontem.`);
    } else {
      alert("Nenhuma conta com CPA mais de R$2 acima da meta ontem.");
    }
  }

  async function handleRunCreativesPause() {
    setRunningCreativesPause(true);
    const res = await fetch("/api/alerts/creatives-pause", { method: "POST" });
    const d = await res.json();
    setRunningCreativesPause(false);
    if (d.error) {
      setCreativesPauseError(d.error);
      return;
    }
    setCreativesPauseError(null);
    setCreativesSendError(d.sendError ?? null);
    setPausedCreatives(d.paused ?? []);
    const ok = (d.paused ?? []).filter((p: PausedCreative) => p.ok).length;
    if (d.sendError) {
      alert(`${ok} criativo(s) pausado(s), mas não deu pra enviar o aviso: ${d.sendError}`);
    } else if (ok > 0) {
      alert(`${ok} criativo(s) pausado(s) automaticamente — aviso enviado pro grupo.`);
    } else {
      alert("Nenhum criativo acima da meta agora.");
    }
  }

  async function handleRunAdSetsPause() {
    setRunningAdSetsPause(true);
    const res = await fetch("/api/alerts/adsets-pause", { method: "POST" });
    const d = await res.json();
    setRunningAdSetsPause(false);
    if (d.error) {
      setAdsetsPauseError(d.error);
      return;
    }
    setAdsetsPauseError(null);
    setAdsetsSendError(d.sendError ?? null);
    setPausedAdSets(d.paused ?? []);
    const ok = (d.paused ?? []).filter((p: PausedAdSet) => p.ok).length;
    if (d.sendError) {
      alert(`${ok} conjunto(s) pausado(s), mas não deu pra enviar o aviso: ${d.sendError}`);
    } else if (ok > 0) {
      alert(`${ok} conjunto(s) pausado(s) automaticamente — aviso enviado pro grupo.`);
    } else {
      alert("Nenhum conjunto acima da meta agora.");
    }
  }

  async function handleRunBudgetIncrease() {
    setRunningBudgetIncrease(true);
    const res = await fetch("/api/alerts/budget-increase", { method: "POST" });
    const d = await res.json();
    setRunningBudgetIncrease(false);
    if (d.error) {
      setBudgetError(d.error);
      return;
    }
    setBudgetError(null);
    setBudgetSendError(d.sendError ?? null);
    setIncreasedAdSets(d.increased ?? []);
    const ok = (d.increased ?? []).filter((i: IncreasedAdSet) => i.ok).length;
    if (d.sendError) {
      alert(`${ok} conjunto(s) com orçamento aumentado, mas não deu pra enviar o aviso: ${d.sendError}`);
    } else if (ok > 0) {
      alert(`${ok} conjunto(s) com orçamento aumentado automaticamente — aviso enviado pro grupo.`);
    } else {
      alert("Nenhum conjunto com CPA bom nos últimos 3 dias agora.");
    }
  }

  async function handleCheckLowInvestment() {
    setCheckingLowInvestment(true);
    const res = await fetch("/api/alerts/low-investment", { method: "POST" });
    const d = await res.json();
    setCheckingLowInvestment(false);
    if (d.error) {
      setLowInvestmentError(d.error);
      return;
    }
    setLowInvestmentError(null);
    setLowInvestmentSendError(d.sendError ?? null);
    setLowInvestmentStatuses(d.statuses ?? []);
    const low = (d.statuses ?? []).filter((s: LowInvestmentStatus) => s.low).length;
    if (d.sendError) {
      alert(`Não deu pra enviar o aviso: ${d.sendError}`);
    } else if (low > 0) {
      alert(`Aviso enviado pro grupo — ${low} conta(s) com investimento baixo.`);
    } else {
      alert("Nenhuma conta com investimento baixo agora.");
    }
  }

  async function handleRunBulkStatus() {
    setRunningBulkStatus(true);
    const res = await fetch("/api/alerts/bulk-status", { method: "POST" });
    const d = await res.json();
    setRunningBulkStatus(false);
    if (d.error) {
      setBulkStatusError(d.error);
      return;
    }
    setBulkStatusError(null);
    setBulkStatusSendError(d.sendError ?? null);
    setBulkStatusResults(d.results ?? []);
    const updated = (d.results ?? []).filter((r: BulkStatusResult) => r.outcome === "updated").length;
    if (d.sendError) {
      alert(`${updated} conta(s) com status atualizado, mas não deu pra enviar o aviso: ${d.sendError}`);
    } else if (updated > 0) {
      alert(`${updated} conta(s) com status atualizado — quadro reordenado e aviso enviado pro grupo.`);
    } else {
      alert("Nenhum status mudou nessa verificação — quadro já reordenado.");
    }
  }

  const low = (statuses ?? []).filter((s) => s.low);
  const ok = (statuses ?? []).filter((s) => !s.low);

  const withError = (paymentStatuses ?? []).filter((s) => s.hasError);
  const paymentOk = (paymentStatuses ?? []).filter((s) => !s.hasError);

  const cpaCritical = [...(cpaStatuses ?? [])].filter((s) => s.critical).sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));
  const cpaOk = (cpaStatuses ?? []).filter((s) => !s.critical);

  const lowInvestmentCritical = [...(lowInvestmentStatuses ?? [])].filter((s) => s.low).sort((a, b) => b.diff - a.diff);
  const lowInvestmentOk = (lowInvestmentStatuses ?? []).filter((s) => !s.low);

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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera toda conta com CPA ideal cadastrado (Clientes/Acompanhamento). Entra no aviso quem
          teve o CPA de ONTEM mais de R$2 acima do CPA ideal — quem ficou na média ou abaixo não aparece
          na mensagem. Vai numa única mensagem pro mesmo grupo de Configurações → WhatsApp, da conta mais
          crítica pra menos crítica. Pensado pra rodar automaticamente uma vez por dia, de manhã (veja o
          ⚠️ no README sobre o agendamento no n8n) — sem cooldown de 24h, então &quot;Verificar agora&quot;
          sempre reenvia se houver alguma conta crítica.
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">CPA acima da meta ontem</h3>
            <button
              onClick={() => void handleCheckCpa()}
              disabled={checkingCpa}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {checkingCpa ? "Verificando…" : "Verificar agora"}
            </button>
          </div>

          {cpaSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {cpaSendError}
            </p>
          ) : null}

          {cpaError ? (
            <p className="px-4 py-6 text-sm text-red-600">{cpaError}</p>
          ) : !cpaStatuses ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : cpaStatuses.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum cliente com CPA ideal cadastrado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 text-right font-medium">CPA ideal</th>
                    <th className="px-4 py-2 text-right font-medium">CPA de ontem</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cpaCritical, ...cpaOk].map((s) => (
                    <tr key={s.ad_account_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.client_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.cpa_target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {s.cpa_yesterday == null ? "—" : fmtCurrency(s.cpa_yesterday)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.critical
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          }`}
                        >
                          {s.critical ? "Acima da meta" : "OK"}
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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera toda conta com CPA ideal cadastrado, período fixo &quot;últimos 3 dias + hoje&quot;. Ao
          clicar, já PAUSA de verdade (mesmo limite de Análise → Criativos: R$4+ acima da meta, com ou
          sem conversa) e manda o aviso — não é só uma prévia. Pensado pra rodar automaticamente várias
          vezes ao dia via n8n (veja o ⚠️ no README).
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Criativos acima da meta (pausa automática)</h3>
            <button
              onClick={() => void handleRunCreativesPause()}
              disabled={runningCreativesPause}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {runningCreativesPause ? "Verificando…" : "Verificar e pausar agora"}
            </button>
          </div>

          {creativesSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {creativesSendError}
            </p>
          ) : null}

          {creativesPauseError ? (
            <p className="px-4 py-6 text-sm text-red-600">{creativesPauseError}</p>
          ) : !pausedCreatives ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Clique em &quot;Verificar e pausar agora&quot; pra rodar.</p>
          ) : pausedCreatives.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum criativo acima da meta na última verificação.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Anúncio</th>
                    <th className="px-4 py-2 text-right font-medium">Custo/conversa</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pausedCreatives.map((p) => (
                    <tr key={p.ad_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{p.client_name}</td>
                      <td className="max-w-[260px] truncate px-4 py-2" title={p.ad_name}>{p.ad_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.cost_per_conversation == null ? `gasto ${fmtCurrency(p.spend)}` : fmtCurrency(p.cost_per_conversation)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.ok
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                          title={p.ok ? undefined : p.error}
                        >
                          {p.ok ? "Pausado" : "Falha ao pausar"}
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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera toda conta com CPA ideal cadastrado, período fixo &quot;últimos 3 dias + hoje&quot;. Ao
          clicar, já PAUSA de verdade (mesmo limite de Análise → Conjuntos: dobro da meta + R$1, com ou
          sem conversa, ou sem anúncio ativo dentro) e manda o aviso — não é só uma prévia. Pensado pra
          rodar automaticamente várias vezes ao dia via n8n, 5 minutos depois do check de Criativos
          acima (veja o ⚠️ no README).
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Conjuntos acima da meta (pausa automática)</h3>
            <button
              onClick={() => void handleRunAdSetsPause()}
              disabled={runningAdSetsPause}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {runningAdSetsPause ? "Verificando…" : "Verificar e pausar agora"}
            </button>
          </div>

          {adsetsSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {adsetsSendError}
            </p>
          ) : null}

          {adsetsPauseError ? (
            <p className="px-4 py-6 text-sm text-red-600">{adsetsPauseError}</p>
          ) : !pausedAdSets ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Clique em &quot;Verificar e pausar agora&quot; pra rodar.</p>
          ) : pausedAdSets.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum conjunto acima da meta na última verificação.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Conjunto</th>
                    <th className="px-4 py-2 text-right font-medium">Custo/conversa</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pausedAdSets.map((p) => (
                    <tr key={p.adset_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{p.client_name}</td>
                      <td className="max-w-[260px] truncate px-4 py-2" title={p.adset_name}>{p.adset_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {!p.has_active_ad
                          ? "sem anúncio ativo"
                          : p.cost_per_conversation == null
                            ? `gasto ${fmtCurrency(p.spend)}`
                            : fmtCurrency(p.cost_per_conversation)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.ok
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                          title={p.ok ? undefined : p.error}
                        >
                          {p.ok ? "Pausado" : "Falha ao pausar"}
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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera toda conta com CPA ideal cadastrado, período fixo &quot;últimos 3 dias&quot; (sem hoje).
          Ao clicar, já AUMENTA de verdade o orçamento diário em R$2,50 fixo de todo conjunto com CPA
          abaixo da meta (mesmo critério de Análise → Conjuntos &quot;abaixo da meta&quot;) e manda o
          aviso — não é só uma prévia. Pensado pra rodar automaticamente 1x por dia de manhã via n8n
          (veja o ⚠️ no README).
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Conjuntos com CPA bom (aumento automático de orçamento)</h3>
            <button
              onClick={() => void handleRunBudgetIncrease()}
              disabled={runningBudgetIncrease}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {runningBudgetIncrease ? "Verificando…" : "Verificar e aumentar agora"}
            </button>
          </div>

          {budgetSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {budgetSendError}
            </p>
          ) : null}

          {budgetError ? (
            <p className="px-4 py-6 text-sm text-red-600">{budgetError}</p>
          ) : !increasedAdSets ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Clique em &quot;Verificar e aumentar agora&quot; pra rodar.</p>
          ) : increasedAdSets.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum conjunto com CPA bom nos últimos 3 dias na última verificação.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Conjunto</th>
                    <th className="px-4 py-2 text-right font-medium">Novo orçamento diário</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {increasedAdSets.map((i) => (
                    <tr key={i.adset_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{i.client_name}</td>
                      <td className="max-w-[260px] truncate px-4 py-2" title={i.adset_name}>{i.adset_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {i.new_daily_budget == null ? "—" : fmtCurrency(i.new_daily_budget)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            i.ok
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                          title={i.ok ? undefined : i.error}
                        >
                          {i.ok ? "Aumentado" : "Falha"}
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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Considera toda conta com Investimento mensal cadastrado (Clientes/Acompanhamento). Entra no
          aviso quem está com o orçamento diário atual MENOR que o Ritmo necessário pra bater a meta do
          mês — qualquer diferença, sem banda de tolerância. Só avisa, nunca muda nada. Pensado pra
          rodar automaticamente de manhã, de segunda a sexta (veja o ⚠️ no README) — sem cooldown, então
          &quot;Verificar agora&quot; sempre reenvia se houver alguma conta com investimento baixo.
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Investimento baixo</h3>
            <button
              onClick={() => void handleCheckLowInvestment()}
              disabled={checkingLowInvestment}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {checkingLowInvestment ? "Verificando…" : "Verificar agora"}
            </button>
          </div>

          {lowInvestmentSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {lowInvestmentSendError}
            </p>
          ) : null}

          {lowInvestmentError ? (
            <p className="px-4 py-6 text-sm text-red-600">{lowInvestmentError}</p>
          ) : !lowInvestmentStatuses ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
          ) : lowInvestmentStatuses.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhum cliente com Investimento mensal cadastrado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 text-right font-medium">Invest. diário atual</th>
                    <th className="px-4 py-2 text-right font-medium">Ritmo necessário</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lowInvestmentCritical, ...lowInvestmentOk].map((s) => (
                    <tr key={s.ad_account_id} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.client_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.daily_budget)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.ritmo)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.low
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          }`}
                        >
                          {s.low ? "Investimento baixo" : "OK"}
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

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Reclassifica toda &quot;Conta exibida&quot; do Painel com o CPA dos últimos 3 dias (sem contar
          hoje) — mesmo critério do botão &quot;Atualizar status em massa&quot; de Acompanhamento. Sempre
          desconsidera contas em inauguração. Ao clicar, já ATUALIZA de verdade o status de quem mudou e
          reordena o quadro inteiro (status mais crítico primeiro e, dentro de cada status, do maior CPA
          pro menor) — não é só uma prévia. O aviso no WhatsApp traz o status de TODO cliente classificado
          nessa rodada (mudou ou manteve), sempre só &quot;cliente: status&quot;, sem dizer qual dos dois
          casos é e sem nenhum outro comentário — só fica de fora quem foi pulado (inauguração, sem meta de
          CPA ou sem gasto no período). Pensado pra rodar automaticamente segunda e quinta de madrugada via
          n8n (veja o ⚠️ no README).
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Atualização de status em massa</h3>
            <button
              onClick={() => void handleRunBulkStatus()}
              disabled={runningBulkStatus}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {runningBulkStatus ? "Verificando…" : "Verificar e atualizar agora"}
            </button>
          </div>

          {bulkStatusSendError ? (
            <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {bulkStatusSendError}
            </p>
          ) : null}

          {bulkStatusError ? (
            <p className="px-4 py-6 text-sm text-red-600">{bulkStatusError}</p>
          ) : !bulkStatusResults ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Clique em &quot;Verificar e atualizar agora&quot; pra rodar.</p>
          ) : bulkStatusResults.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta exibida ainda (Painel → Contas exibidas).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkStatusResults.map((r) => (
                    <tr key={r.accountId} className="border-t border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{r.clientName}</td>
                      <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                        {r.outcome === "updated"
                          ? `${priorityLabel(r.from)} → ${priorityLabel(r.to)}`
                          : r.outcome === "unchanged"
                            ? `Já em ${priorityLabel(r.to)}`
                            : r.reason}
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
