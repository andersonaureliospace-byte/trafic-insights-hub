"use client";

import { useState } from "react";

// Etapa 278: no aplicativo instalado não tem o botão de recarregar do navegador. Este botão recarrega o Hub e pega a
// versão nova (depois de um push), sem fechar o app: atualiza o service worker, limpa caches do navegador e recarrega.
export function RecarregarApp() {
  const [busy, setBusy] = useState(false);
  async function recarregar() {
    setBusy(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* recarrega mesmo assim */
    }
    // muda a URL (parâmetro descartável) pra não reaproveitar a página guardada
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(Date.now()));
    window.location.replace(url.toString());
  }
  return (
    <button
      onClick={() => void recarregar()}
      disabled={busy}
      title="Recarregar o app (pega a versão mais nova)"
      aria-label="Recarregar o app"
      className="h-8 w-8 rounded-md text-base text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-white/5"
    >
      <span className={`inline-block ${busy ? "animate-spin" : ""}`}>↻</span>
    </button>
  );
}
