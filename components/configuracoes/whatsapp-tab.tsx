"use client";

import { useCallback, useEffect, useState } from "react";

interface WhatsappGroup {
  id: string;
  name: string;
}

export function WhatsappTab() {
  const [loading, setLoading] = useState(true);
  const [apiUrl, setApiUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credMessage, setCredMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [status, setStatus] = useState("disconnected");
  const [connected, setConnected] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<"qr" | "pair">("qr");
  const [phone, setPhone] = useState("");
  const [session, setSession] = useState<{ qrcode: string | null; paircode: string | null } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [groups, setGroups] = useState<WhatsappGroup[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [alertsGroupId, setAlertsGroupId] = useState<string | null>(null);
  const [alertsGroupName, setAlertsGroupName] = useState<string | null>(null);
  const [savingAlertsGroup, setSavingAlertsGroup] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/credentials")
      .then((r) => r.json())
      .then((d) => {
        setApiUrl(d.api_url ?? "");
        setToken(d.token ?? "");
        setConfigured(!!d.configured);
        setStatus(d.status ?? "disconnected");
        setAlertsGroupId(d.alerts_group_id ?? null);
        setAlertsGroupName(d.alerts_group_name ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/whatsapp/status");
    const d = await res.json();
    if (d.error) {
      setStatusError(d.error);
      return;
    }
    setStatusError(null);
    setStatus(d.status);
    setConnected(!!d.connected);
  }, []);

  useEffect(() => {
    if (!configured) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- checa o status da instância assim que ela fica configurada, e depois a cada N segundos
    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), connected ? 30000 : 4000);
    return () => clearInterval(interval);
  }, [configured, connected, refreshStatus]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const res = await fetch("/api/whatsapp/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "pair" && phone ? { phone: phone.replace(/\D/g, "") } : {}),
    });
    const d = await res.json();
    setConnecting(false);
    if (d.error) {
      setStatusError(d.error);
      return;
    }
    setStatusError(null);
    setSession({ qrcode: d.qrcode, paircode: d.paircode });
    setStatus(d.status);
    setConnected(!!d.connected);
  }, [mode, phone]);

  // Renova o QR a cada 30s enquanto aguarda a leitura.
  useEffect(() => {
    if (connected || !session?.qrcode || mode !== "qr") return;
    const t = setInterval(() => void handleConnect(), 30000);
    return () => clearInterval(t);
  }, [session?.qrcode, connected, mode, handleConnect]);

  useEffect(() => {
    if (connected && session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fecha o QR/código assim que a conexão é detectada
      setSession(null);
    }
  }, [connected, session]);

  async function saveCredentials() {
    setSavingCreds(true);
    setCredMessage(null);
    const res = await fetch("/api/whatsapp/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_url: apiUrl, token }),
    });
    setSavingCreds(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setCredMessage({ kind: "error", text: d.error ?? "Erro ao salvar." });
      return;
    }
    setCredMessage({ kind: "ok", text: "Salvo." });
    setConfigured(true);
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar WhatsApp?")) return;
    setDisconnecting(true);
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    setDisconnecting(false);
    setSession(null);
    void refreshStatus();
  }

  async function loadGroups(force: boolean) {
    setLoadingGroups(true);
    setGroupsError(null);
    const res = await fetch("/api/whatsapp/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const d = await res.json();
    setLoadingGroups(false);
    if (d.error) {
      setGroupsError(d.error);
      return;
    }
    setGroups(d.groups ?? []);
  }

  async function saveAlertsGroup(id: string) {
    const g = groups?.find((x) => x.id === id) ?? null;
    setAlertsGroupId(g?.id ?? null);
    setAlertsGroupName(g?.name ?? null);
    setSavingAlertsGroup(true);
    await fetch("/api/whatsapp/alerts-group", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerts_group_id: g?.id ?? null, alerts_group_name: g?.name ?? null }),
    });
    setSavingAlertsGroup(false);
  }

  if (loading) return <p className="text-sm text-zinc-500">Carregando…</p>;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Instância uazapi</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          URL e token da sua instância do uazapi. É por aqui que o sistema conecta com o WhatsApp
          pra enviar mensagens e ler os grupos.
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">URL da API</label>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://sua-instancia.uazapi.com"
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Token</label>
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="token da instância"
              className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              className="rounded-md border border-zinc-300 px-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            >
              {showToken ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        {credMessage ? (
          <p className={`mt-3 text-sm ${credMessage.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
            {credMessage.text}
          </p>
        ) : null}

        <button
          onClick={saveCredentials}
          disabled={savingCreds}
          className="mt-5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {savingCreds ? "Salvando…" : "Salvar"}
        </button>
      </div>

      {configured ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Conexão</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                connected
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {connected ? "Conectado" : status}
            </span>
          </div>

          {statusError ? <p className="mt-2 text-sm text-red-600">{statusError}</p> : null}

          {connected ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Pra trocar de número, desconecte primeiro.
              </p>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 disabled:opacity-60 dark:border-red-800"
              >
                {disconnecting ? "Desconectando…" : "Desconectar"}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              {!panelOpen ? (
                <button
                  onClick={() => setPanelOpen(true)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
                >
                  Conectar
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
                      <button
                        type="button"
                        onClick={() => setMode("qr")}
                        className={`rounded px-3 py-1 text-xs ${
                          mode === "qr" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""
                        }`}
                      >
                        QR Code
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("pair")}
                        className={`rounded px-3 py-1 text-xs ${
                          mode === "pair" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""
                        }`}
                      >
                        Código de pareamento
                      </button>
                    </div>
                    {mode === "pair" ? (
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="5511999998888"
                        inputMode="numeric"
                        className="h-8 w-48 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
                      />
                    ) : null}
                    <button
                      onClick={() => void handleConnect()}
                      disabled={connecting || (mode === "pair" && phone.replace(/\D/g, "").length < 10)}
                      className="h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {connecting ? "…" : session ? "Gerar novo" : "Conectar"}
                    </button>
                  </div>

                  {session?.qrcode && mode === "qr" ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagem base64 gerada dinamicamente pelo uazapi, não faz sentido otimizar */}
                      <img
                        src={session.qrcode.startsWith("data:") ? session.qrcode : `data:image/png;base64,${session.qrcode}`}
                        alt="QR Code do WhatsApp"
                        className="size-56"
                      />
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Abra o WhatsApp → Aparelhos conectados → Conectar aparelho. O QR renova a cada 30s.
                      </p>
                    </div>
                  ) : null}

                  {session?.paircode && mode === "pair" ? (
                    <div className="flex flex-col items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="font-mono text-2xl tracking-widest">{session.paircode}</div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        No WhatsApp: Aparelhos conectados → Conectar aparelho → Conectar com número.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Grupo para alertas de saldo {savingAlertsGroup ? "· salvando…" : ""}
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <select
                value={alertsGroupId ?? ""}
                onChange={(e) => void saveAlertsGroup(e.target.value)}
                onFocus={() => {
                  if (!groups) void loadGroups(false);
                }}
                className="h-8 min-w-[220px] rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700"
              >
                <option value="">— Nenhum —</option>
                {alertsGroupId && !groups?.some((g) => g.id === alertsGroupId) ? (
                  <option value={alertsGroupId}>{alertsGroupName ?? alertsGroupId}</option>
                ) : null}
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadGroups(true)}
                disabled={loadingGroups}
                className="h-8 rounded-md border border-zinc-300 px-2 text-xs font-medium disabled:opacity-60 dark:border-zinc-700"
              >
                {loadingGroups ? "Atualizando…" : "Atualizar grupos"}
              </button>
            </div>
            {groupsError ? <p className="mt-2 text-xs text-red-600">{groupsError}</p> : null}
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Esse grupo recebe os avisos automáticos de saldo baixo (Controle de Saldo → PIX), via n8n.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
