"use client";

import { useState } from "react";

export function PublicLinkCell({
  accountId,
  accountName,
  token,
  onChange,
}: {
  accountId: string;
  accountName: string;
  token: string | null;
  onChange: (token: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    const res = await fetch("/api/public-dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: accountId, account_name: accountName }),
    });
    const d = await res.json();
    setBusy(false);
    if (d.public_token) onChange(d.public_token);
  }

  async function copyLink() {
    if (!token) return;
    const url = `${window.location.origin}/d/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível — sem tratamento especial, o link já fica visível no title
    }
  }

  async function remove() {
    if (!confirm("Remover o link público desta conta? Quem tiver o link atual perde o acesso.")) return;
    setBusy(true);
    await fetch(`/api/public-dashboards?ad_account_id=${encodeURIComponent(accountId)}`, { method: "DELETE" });
    setBusy(false);
    onChange(null);
  }

  if (!token) {
    return (
      <button
        onClick={() => void generate()}
        disabled={busy}
        className="rounded border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400"
      >
        {busy ? "Gerando…" : "Gerar link"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => void copyLink()}
        title={`${typeof window !== "undefined" ? window.location.origin : ""}/d/${token}`}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
      >
        {copied ? "Copiado!" : "Copiar link"}
      </button>
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-60"
        title="Remover link público"
      >
        ✕
      </button>
    </div>
  );
}
