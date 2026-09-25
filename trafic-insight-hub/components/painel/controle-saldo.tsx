"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdAccount, AccountInsight } from "@/lib/meta/insights";
import { fmtCurrency } from "@/lib/format";
import { billingHubUrl } from "@/lib/meta/ads-manager-link";
import { availableFunds } from "@/lib/meta/funds";
import { PersonalizarAlertasDialog, type PixRow, type PixPatch } from "@/components/painel/personalizar-alertas-dialog";
import { EnviarPixDialog } from "@/components/painel/enviar-pix-dialog";

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

interface BoletoSend {
  id: string;
  ad_account_id: string;
  client_name: string;
  due_date: string;
  pdf_file_name: string;
  status: string;
  error: string | null;
  created_at: string;
}

interface PixSend {
  id: string;
  ad_account_id: string;
  client_name: string;
  target_type: string;
  target_label: string;
  scheduled_at: string | null;
  status: string;
  error: string | null;
  created_at: string;
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
  insights,
  onPatch,
  onRefresh,
  refreshing,
}: {
  accounts: AdAccount[];
  clientNames: Record<string, string>;
  pixByAccount: Record<string, PixRow>;
  // Etapa 75: orçamento diário atual (coluna "Invest. diário") — mesmo dado
  // já buscado pra Acompanhamento (insight.daily_budget, independente do
  // período escolhido no filtro de lá), reaproveitado aqui.
  insights: Record<string, AccountInsight>;
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

  // Etapa 71: envio de boleto por e-mail (upload do PDF → dispara pro n8n,
  // que manda de verdade pelo Gmail — ver app/api/boletos/send/route.ts).
  const [boletoAccountId, setBoletoAccountId] = useState("");
  const [boletoDueDate, setBoletoDueDate] = useState("");
  const [boletoFile, setBoletoFile] = useState<{ url: string; fileName: string } | null>(null);
  const [boletoUploading, setBoletoUploading] = useState(false);
  const [boletoSending, setBoletoSending] = useState(false);
  const [boletoMsg, setBoletoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const boletoFileInputRef = useRef<HTMLInputElement>(null);
  const [boletoHistory, setBoletoHistory] = useState<BoletoSend[] | null>(null);
  const [boletoHistoryOpen, setBoletoHistoryOpen] = useState(false);

  // Etapa 73: envio de Pix por WhatsApp — o botão fica na coluna Ação de cada
  // conta pendente (destino já configurado em Personalizar alertas); aqui só
  // guardamos qual conta abriu o modal e o histórico dos últimos envios.
  const [pixDialogAccount, setPixDialogAccount] = useState<{ id: string; clientName: string } | null>(null);
  const [pixHistory, setPixHistory] = useState<PixSend[] | null>(null);
  const [pixHistoryOpen, setPixHistoryOpen] = useState(false);

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

  async function uploadBoleto(file: File) {
    setBoletoUploading(true);
    setBoletoMsg(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/boletos/upload", { method: "POST", body: form });
      const d = await res.json();
      if (d.error) {
        setBoletoMsg({ ok: false, text: d.error });
      } else {
        setBoletoFile({ url: d.url, fileName: d.fileName });
      }
    } catch {
      setBoletoMsg({ ok: false, text: "Falha ao enviar o PDF." });
    }
    setBoletoUploading(false);
  }

  async function loadBoletoHistory() {
    const res = await fetch("/api/boletos/history").then((r) => r.json());
    setBoletoHistory(res.sends ?? []);
  }

  async function loadPixHistory() {
    const res = await fetch("/api/pix/history").then((r) => r.json());
    setPixHistory(res.sends ?? []);
  }

  async function sendBoleto() {
    if (!boletoAccountId || !boletoDueDate || !boletoFile) return;
    setBoletoSending(true);
    setBoletoMsg(null);
    try {
      const res = await fetch("/api/boletos/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: boletoAccountId,
          due_date: boletoDueDate,
          pdf_url: boletoFile.url,
          pdf_file_name: boletoFile.fileName,
        }),
      });
      const d = await res.json();
      if (d.error) {
        setBoletoMsg({ ok: false, text: d.error });
      } else {
        setBoletoMsg({ ok: true, text: "E-mail disparado — pode conferir no financeiro." });
        setBoletoFile(null);
        setBoletoDueDate("");
        if (boletoFileInputRef.current) boletoFileInputRef.current.value = "";
        if (boletoHistoryOpen) void loadBoletoHistory();
      }
    } catch {
      setBoletoMsg({ ok: false, text: "Falha ao disparar o e-mail." });
    }
    setBoletoSending(false);
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

  const sortedAccountsForBoleto = [...accounts].sort((a, b) =>
    (clientNames[a.account_id] ?? a.name).localeCompare(clientNames[b.account_id] ?? b.name, "pt-BR"),
  );

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
            onClick={() => {
              setPixHistoryOpen((v) => !v);
              if (!pixHistoryOpen && pixHistory === null) void loadPixHistory();
            }}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-sm font-medium dark:border-zinc-700"
          >
            {pixHistoryOpen ? "Ocultar histórico de Pix" : "📲 Histórico de Pix"}
          </button>
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

      {/* Etapa 71: envio de boleto por e-mail — sobe o PDF, escolhe cliente e
          vencimento, e dispara o e-mail padrão pro financeiro (texto fixo,
          só troca loja/data/anexo). Ver app/api/boletos/*. */}
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">📧 Enviar boleto por e-mail</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Sobe o boleto em PDF e dispara o e-mail padrão pro financeiro — só troca a loja e o vencimento.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Cliente</label>
            <select
              value={boletoAccountId}
              onChange={(e) => setBoletoAccountId(e.target.value)}
              className="h-8 min-w-[220px] rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            >
              <option value="">Selecione…</option>
              {sortedAccountsForBoleto.map((acc) => (
                <option key={acc.account_id} value={acc.account_id}>
                  {clientNames[acc.account_id] ?? acc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Vencimento</label>
            <input
              type="date"
              value={boletoDueDate}
              onChange={(e) => setBoletoDueDate(e.target.value)}
              className="h-8 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Boleto (PDF)</label>
            <input
              ref={boletoFileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadBoleto(f);
              }}
            />
            {boletoFile ? (
              <span className="flex h-8 items-center gap-2 rounded-md border border-zinc-300 px-2 text-xs dark:border-zinc-700">
                📎 <span className="max-w-[160px] truncate">{boletoFile.fileName}</span>
                <button
                  onClick={() => {
                    setBoletoFile(null);
                    if (boletoFileInputRef.current) boletoFileInputRef.current.value = "";
                  }}
                  className="font-medium text-red-600"
                >
                  Remover
                </button>
              </span>
            ) : (
              <button
                onClick={() => boletoFileInputRef.current?.click()}
                disabled={boletoUploading}
                className="h-8 rounded-md border border-zinc-300 px-2.5 text-xs font-medium disabled:opacity-60 dark:border-zinc-700"
              >
                {boletoUploading ? "Enviando…" : "📎 Anexar PDF"}
              </button>
            )}
          </div>
          <button
            onClick={() => void sendBoleto()}
            disabled={boletoSending || boletoUploading || !boletoAccountId || !boletoDueDate || !boletoFile}
            className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {boletoSending ? "Enviando…" : "Enviar e-mail"}
          </button>
          <button
            onClick={() => {
              setBoletoHistoryOpen((v) => !v);
              if (!boletoHistoryOpen && boletoHistory === null) void loadBoletoHistory();
            }}
            className="h-8 rounded-md border border-zinc-300 px-2.5 text-xs font-medium dark:border-zinc-700"
          >
            {boletoHistoryOpen ? "Ocultar histórico" : "Ver histórico"}
          </button>
        </div>
        {boletoMsg ? (
          <p
            className={`mt-2 text-xs font-medium ${
              boletoMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"
            }`}
          >
            {boletoMsg.text}
          </p>
        ) : null}
        {boletoHistoryOpen ? (
          <div className="mt-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {boletoHistory === null ? (
              <p className="px-3 py-2 text-xs text-zinc-500">Carregando…</p>
            ) : boletoHistory.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">Nenhum envio ainda.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-zinc-400">
                    <th className="px-3 py-1 font-medium">Loja</th>
                    <th className="px-3 py-1 font-medium">Vencimento</th>
                    <th className="px-3 py-1 font-medium">Arquivo</th>
                    <th className="px-3 py-1 font-medium">Status</th>
                    <th className="px-3 py-1 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {boletoHistory.map((s) => (
                    <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                      <td className="px-3 py-1.5">{s.client_name}</td>
                      <td className="px-3 py-1.5">{fmtDateBR(s.due_date)}</td>
                      <td className="max-w-[160px] truncate px-3 py-1.5">{s.pdf_file_name || "—"}</td>
                      <td className="px-3 py-1.5">
                        {s.status === "sent" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Enviado</span>
                        ) : s.status === "error" ? (
                          <span title={s.error ?? ""} className="text-red-600">
                            Erro
                          </span>
                        ) : (
                          <span className="text-zinc-500">Pendente</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">{new Date(s.created_at).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>

      {/* Etapa 73: histórico de Pix — o envio em si acontece pelo botão
          "Enviar Pix" na coluna Ação de cada conta pendente (o destino já
          vem configurado em Personalizar alertas). Ver app/api/pix/*. */}
      {pixHistoryOpen ? (
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">📲 Histórico de Pix</h3>
          <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {pixHistory === null ? (
              <p className="px-3 py-2 text-xs text-zinc-500">Carregando…</p>
            ) : pixHistory.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">Nenhum envio ainda.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-zinc-400">
                    <th className="px-3 py-1 font-medium">Loja</th>
                    <th className="px-3 py-1 font-medium">Destino</th>
                    <th className="px-3 py-1 font-medium">Status</th>
                    <th className="px-3 py-1 font-medium">Agendado para</th>
                    <th className="px-3 py-1 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {pixHistory.map((s) => (
                    <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                      <td className="px-3 py-1.5">{s.client_name}</td>
                      <td className="max-w-[160px] truncate px-3 py-1.5">
                        {s.target_type === "numero" ? "Número" : "Grupo"}: {s.target_label || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {s.status === "sent" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Enviado</span>
                        ) : s.status === "error" ? (
                          <span title={s.error ?? ""} className="text-red-600">
                            Erro
                          </span>
                        ) : s.status === "scheduled" ? (
                          <span className="text-zinc-500">Programado</span>
                        ) : (
                          <span className="text-zinc-500">Pendente</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">
                        {s.scheduled_at ? new Date(s.scheduled_at).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">{new Date(s.created_at).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

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
                <th
                  className="px-4 py-1.5 text-right font-medium"
                  title="Orçamento diário atual dos conjuntos/campanhas ativos (mesmo dado de Acompanhamento)"
                >
                  Invest. diário
                </th>
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
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtCurrency(insights[acc.account_id]?.daily_budget, acc.currency)}
                    </td>
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
                      <div className="flex flex-wrap gap-1.5">
                        {hasManualDue ? (
                          <button
                            onClick={() => void handleVerify(acc.account_id)}
                            disabled={verifyingId === acc.account_id}
                            className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                          >
                            {verifyingId === acc.account_id ? "Marcando…" : "Marcar como verificado"}
                          </button>
                        ) : null}
                        <button
                          onClick={() =>
                            setPixDialogAccount({
                              id: acc.account_id,
                              clientName: clientNames[acc.account_id] ?? acc.name,
                            })
                          }
                          className="h-7 rounded-md border border-zinc-300 px-2 text-xs font-medium dark:border-zinc-700"
                        >
                          📲 Enviar Pix
                        </button>
                      </div>
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

      <EnviarPixDialog
        open={pixDialogAccount !== null}
        onClose={() => setPixDialogAccount(null)}
        accountId={pixDialogAccount?.id ?? ""}
        clientName={pixDialogAccount?.clientName ?? ""}
        pixRow={pixDialogAccount ? pixByAccount[pixDialogAccount.id] : undefined}
        onSent={() => {
          if (pixHistoryOpen) void loadPixHistory();
        }}
      />
    </div>
  );
}
