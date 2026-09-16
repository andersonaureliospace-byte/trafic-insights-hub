"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdAccount } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";
import { billingHubUrl } from "@/lib/meta/ads-manager-link";
import { availableFunds } from "@/lib/meta/funds";
import { PersonalizarAlertasDialog, type PixRow, type PixPatch } from "@/components/painel/personalizar-alertas-dialog";

export type { PixRow, PixPatch };

interface BalanceStatus {
  ad_account_id: string;
  balance: number;
  currency: string;
  threshold: number;
  low: boolean;
}

interface FridayBalanceStatus {
  ad_account_id: string;
  balance: number;
  currency: string;
  multiplier: number;
  fridayThreshold: number;
  applicable: boolean;
  low: boolean;
}

interface PaymentStatus {
  ad_account_id: string;
  reason: string | null;
  hasError: boolean;
}

interface ManualCheckStatus {
  ad_account_id: string;
  next_at: string;
  due: boolean;
}

interface Reason {
  key: string;
  label: string;
  tone: "red" | "amber";
}

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Etapa 63: Controle de Saldo virou um quadro de monitoramento orientado a
// alerta — toda conta selecionada é checada (saldo baixo, sexta-feira de fim
// de semana, erro no pagamento e verificação manual), mas só quem tem pelo
// menos um aviso pendente aparece na lista. Quem está tudo OK não aparece
// (nem em cinza, nem colapsado — simplesmente não entra na lista). Ajustar
// os limites, o tipo de conta e as rotinas de cada uma é tudo feito no botão
// "Personalizar alertas", que abre o quadro completo com todas as contas.
export function ControleSaldo({
  accounts,
  clientNames,
  pixByAccount,
  onPatch,
  onRefresh,
  refreshing,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  onPatch: (accountId: string, patch: PixPatch) => Promise<void>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [balanceStatuses, setBalanceStatuses] = useState<BalanceStatus[] | null>(null);
  const [fridayStatuses, setFridayStatuses] = useState<FridayBalanceStatus[] | null>(null);
  const [paymentStatuses, setPaymentStatuses] = useState<PaymentStatus[] | null>(null);
  const [manualStatuses, setManualStatuses] = useState<ManualCheckStatus[] | null>(null);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const loadStatuses = useCallback(async () => {
    setLoadingStatuses(true);
    const [balanceRes, fridayRes, paymentRes, manualRes] = await Promise.all([
      fetch("/api/alerts/balance").then((r) => r.json()),
      fetch("/api/alerts/balance-friday").then((r) => r.json()),
      fetch("/api/alerts/payment").then((r) => r.json()),
      fetch("/api/alerts/manual-check").then((r) => r.json()),
    ]);
    setBalanceStatuses(balanceRes.statuses ?? []);
    setFridayStatuses(fridayRes.statuses ?? []);
    setPaymentStatuses(paymentRes.statuses ?? []);
    setManualStatuses(manualRes.statuses ?? []);
    setLoadingStatuses(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos 4 status que decidem quem aparece como pendente
    void loadStatuses();
  }, [loadStatuses]);

  async function handleVerify(accountId: string) {
    setVerifyingId(accountId);
    await fetch("/api/alerts/manual-check/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId }),
    });
    await loadStatuses();
    setVerifyingId(null);
  }

  async function handleRefresh() {
    onRefresh();
    await loadStatuses();
  }

  // Puxa o tipo de pagamento (pré-paga/pós-paga) direto da Meta — só na
  // "criação" da conta aqui na tela, ou seja, só pra quem ainda não tem
  // Tipo salvo nenhum. Não faz parte da listagem de contas de sempre (que
  // roda a cada carregamento do Painel) de propósito: é uma consulta à
  // parte, feita uma única vez por conta — depois de salvo (puxado ou
  // escolhido à mão), nunca mais é chamada de novo nem sobrescrita
  // automaticamente, mesmo revisitando essa aba.
  const syncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newIds = accounts
      .map((a) => a.account_id)
      .filter((id) => !syncedRef.current.has(id) && !pixByAccount[id]?.payment_type);
    if (newIds.length === 0) return;
    newIds.forEach((id) => syncedRef.current.add(id));
    fetch("/api/meta/payment-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: newIds }),
    })
      .then((r) => r.json())
      .then((d) => {
        const isPrepay: Record<string, boolean | null> = d.isPrepay ?? {};
        for (const id of newIds) {
          const v = isPrepay[id];
          if (v == null) continue;
          void onPatch(id, { payment_type: v ? "prepaid" : "postpaid" });
        }
      })
      .catch(() => {
        // falha ao consultar a Meta — a conta fica sem tipo salvo, pra
        // escolha manual (tenta de novo só se essa aba for reaberta).
      });
  }, [accounts, pixByAccount, onPatch]);

  const balanceById = new Map((balanceStatuses ?? []).map((s) => [s.ad_account_id, s]));
  const fridayById = new Map((fridayStatuses ?? []).map((s) => [s.ad_account_id, s]));
  const paymentById = new Map((paymentStatuses ?? []).map((s) => [s.ad_account_id, s]));
  const manualById = new Map((manualStatuses ?? []).map((s) => [s.ad_account_id, s]));

  const statusesLoaded = balanceStatuses !== null && fridayStatuses !== null && paymentStatuses !== null && manualStatuses !== null;

  const pending = accounts
    .map((acc) => {
      const reasons: Reason[] = [];
      const payment = paymentById.get(acc.account_id);
      const balance = balanceById.get(acc.account_id);
      const friday = fridayById.get(acc.account_id);
      const manual = manualById.get(acc.account_id);

      if (payment?.hasError) {
        reasons.push({ key: "payment", label: payment.reason ?? "Erro no pagamento", tone: "red" });
      }
      if (balance?.low) {
        reasons.push({
          key: "balance",
          label: `Saldo baixo (${fmtCurrency(balance.balance, balance.currency)} < ${fmtCurrency(balance.threshold, balance.currency)})`,
          tone: "red",
        });
      }
      if (friday?.applicable && friday.low) {
        reasons.push({
          key: "friday",
          label: `Sexta: saldo menor que ${friday.multiplier}x o limite (fim de semana)`,
          tone: "amber",
        });
      }
      if (manual?.due) {
        reasons.push({
          key: "manual",
          label: `Verificação manual pendente (desde ${fmtDateBR(manual.next_at)})`,
          tone: "amber",
        });
      }

      return { acc, reasons, hasManualDue: !!manual?.due };
    })
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length);

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Controle de Saldo</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDialogOpen(true)}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
          >
            Personalizar alertas
          </button>
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing || loadingStatuses}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {refreshing || loadingStatuses ? "Atualizando…" : "↻ Atualizar"}
          </button>
        </div>
      </div>

      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-400">
        Todas as contas exibidas são monitoradas — aqui só aparece quem está pendente ou com algum aviso. Contas
        OK não aparecem. Ajuste limites, tipo e rotinas em &quot;Personalizar alertas&quot;.
      </p>

      {accounts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nenhuma conta selecionada.</p>
      ) : !statusesLoaded ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Carregando…</p>
      ) : pending.length === 0 ? (
        <p className="px-4 py-6 text-sm text-emerald-600 dark:text-emerald-400">
          ✅ Tudo certo — nenhuma conta pendente ou com aviso agora.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-1.5 font-medium">Cliente</th>
                <th className="px-4 py-1.5 font-medium">Conta</th>
                <th className="px-4 py-1.5 text-right font-medium">Saldo disponível</th>
                <th className="px-4 py-1.5 font-medium">Avisos</th>
                <th className="px-4 py-1.5 font-medium">Observação</th>
                <th className="px-4 py-1.5 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(({ acc, reasons, hasManualDue }) => {
                const funds = availableFunds(acc);
                const notes = pixByAccount[acc.account_id]?.notes;
                return (
                  <tr key={acc.id} className="border-t border-zinc-100 align-top dark:border-zinc-800/60">
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                      {clientNames[acc.account_id] ?? acc.name}
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={billingHubUrl(acc.account_id, acc.business?.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir Cobranças e Pagamentos"
                        className="text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        {acc.name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(funds.amount, acc.currency)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        {reasons.map((r) => (
                          <span
                            key={r.key}
                            className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.tone === "red"
                                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            }`}
                          >
                            {r.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-[220px] px-4 py-2 text-zinc-600 dark:text-zinc-300">{notes || "—"}</td>
                    <td className="px-4 py-2">
                      {hasManualDue ? (
                        <button
                          onClick={() => void handleVerify(acc.account_id)}
                          disabled={verifyingId === acc.account_id}
                          className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                        >
                          {verifyingId === acc.account_id ? "Marcando…" : "Marcar como verificado"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PersonalizarAlertasDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        accounts={accounts}
        clientNames={clientNames}
        pixByAccount={pixByAccount}
        onPatch={onPatch}
      />
    </div>
  );
}
