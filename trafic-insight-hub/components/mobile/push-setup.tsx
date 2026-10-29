"use client";

import { useEffect, useState } from "react";

// Etapa 221: liga as notificações push deste aparelho. No iPhone só funciona com o app instalado
// (Safari → Compartilhar → "Adicionar à Tela de Início") e aberto pelo ícone.

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "install" | "off" | "on" | "denied";

export function PushSetup() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(standalone ? "unsupported" : "install");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (Notification.permission === "denied") return setState("denied");
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = (await fetch("/api/push").then((r) => r.json())) as { publicKey: string | null };
      if (!publicKey) throw new Error("Faltam as chaves VAPID na Vercel.");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setState("on");
      setMsg({ ok: true, text: "Notificações ligadas neste celular." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const d = await fetch("/api/push/test", { method: "POST" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setMsg({ ok: true, text: "Teste enviado — deve chegar em alguns segundos." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "on") {
    return state === "on" ? (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <span className="flex-1">🔔 Notificações dos avisos urgentes ligadas.</span>
        <button disabled={busy} onClick={test} className="rounded-md border border-emerald-300 px-2 py-1 font-medium dark:border-emerald-800">
          Mandar teste
        </button>
        <button disabled={busy} onClick={disable} className="rounded-md px-2 py-1 text-emerald-700/70 dark:text-emerald-400/70">
          Desligar
        </button>
        {msg && <p className={`w-full ${msg.ok ? "" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    ) : null;
  }

  return (
    <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
      {state === "install" && (
        <p>
          Pra receber notificações no iPhone: no Safari toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, abra o app
          pelo ícone <b>Traffic</b> e volte aqui.
        </p>
      )}
      {state === "unsupported" && <p>Este aparelho não aceita notificações (precisa do iOS 16.4 ou mais novo).</p>}
      {state === "denied" && (
        <p>As notificações foram bloqueadas. Libere em Ajustes → Notificações → Traffic e abra o app de novo.</p>
      )}
      {state === "off" && (
        <div className="flex items-center gap-2">
          <span className="flex-1">Receba no celular os mesmos avisos urgentes que vão pro grupo do WhatsApp.</span>
          <button
            disabled={busy}
            onClick={enable}
            className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Ativando…" : "Ativar notificações"}
          </button>
        </div>
      )}
      {msg && <p className={`mt-2 ${msg.ok ? "" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
