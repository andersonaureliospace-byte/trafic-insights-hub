"use client";

import { useEffect, useState } from "react";

export function MetaCredentialsForm() {
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/meta/credentials")
      .then((r) => r.json())
      .then((d) => {
        setToken(d.access_token ?? "");
        setAccountId(d.default_ad_account_id ?? "");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/meta/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token, default_ad_account_id: accountId }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMessage({ kind: "error", text: d.error ?? "Erro ao salvar." });
      return;
    }
    setMessage({ kind: "ok", text: "Salvo." });
  }

  if (loading) return <p className="text-sm text-zinc-500">Carregando…</p>;

  return (
    <div className="max-w-lg rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Conta Meta (Facebook)</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Token de acesso com permissão <span className="font-mono text-xs">ads_read</span> e{" "}
        <span className="font-mono text-xs">ads_management</span> nas contas que você gerencia.
      </p>

      <div className="mt-4 flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Access token</label>
        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAB…"
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="rounded-md border border-zinc-300 px-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          >
            {show ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Conta de anúncios padrão (opcional)
        </label>
        <input
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="act_123456789"
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
        />
      </div>

      {message ? (
        <p className={`mt-3 text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
          {message.text}
        </p>
      ) : null}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {saving ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}
