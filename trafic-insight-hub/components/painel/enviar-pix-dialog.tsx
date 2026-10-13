"use client";

import { useEffect, useRef, useState } from "react";
import type { PixRow } from "@/components/painel/personalizar-alertas-dialog";

// Etapa 73: modal do botão "Enviar Pix" (coluna Ação de Controle de Saldo) —
// destino (grupo do cliente ou número) já vem configurado em Personalizar
// alertas, então aqui só falta o texto do Pix (copia e cola) e o print, e a
// escolha de mandar agora ou programar o disparo (reaproveita
// whatsapp_scheduled_dispatches, ver app/api/pix/send/route.ts).
export function EnviarPixDialog({
  open,
  onClose,
  accountId,
  clientName,
  pixRow,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  clientName: string;
  pixRow: PixRow | undefined;
  onSent: () => void;
}) {
  const [binding, setBinding] = useState<{ wa_group_id: string | null; wa_group_name: string | null } | null>(null);
  const [loadingBinding, setLoadingBinding] = useState(false);

  const [pixText, setPixText] = useState("");
  const [image, setImage] = useState<{ url: string; mime: string; fileName: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseta o formulário toda vez que o modal abre pra uma conta
    setPixText("");
    setImage(null);
    setUploadError(null);
    setMode("now");
    setScheduleAt("");
    setMsg(null);
    setLoadingBinding(true);
    fetch("/api/account-bindings")
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.bindings ?? []) as Array<{
          ad_account_id: string;
          wa_group_id: string | null;
          wa_group_name: string | null;
        }>;
        const found = rows.find((b) => b.ad_account_id === accountId);
        setBinding(found ? { wa_group_id: found.wa_group_id, wa_group_name: found.wa_group_name } : null);
      })
      .finally(() => setLoadingBinding(false));
  }, [open, accountId]);

  async function uploadImage(file: File) {
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/whatsapp/media", { method: "POST", body: form });
      const d = await res.json();
      if (d.error) {
        setUploadError(d.error);
      } else {
        setImage({ url: d.url, mime: d.mime, fileName: d.fileName, path: d.path });
      }
    } catch {
      setUploadError("Falha ao enviar o print.");
    }
    setUploading(false);
  }

  // Etapa 74: cola direto (Ctrl+V) o print do Pix copiado da área de
  // transferência — sem precisar salvar o arquivo antes pra depois escolher
  // no seletor. Um ref guarda a versão mais recente de uploadImage pra não
  // precisar recriar o listener a cada render (hooks têm que rodar antes do
  // "if (!open) return null" abaixo, senão a ordem dos hooks quebra).
  const uploadImageRef = useRef(uploadImage);
  useEffect(() => {
    uploadImageRef.current = uploadImage;
  });

  useEffect(() => {
    if (!open) return;
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const named =
              file.name && file.name !== "image.png"
                ? file
                : new File([file], `pix-print-${Date.now()}.png`, { type: file.type });
            void uploadImageRef.current(named);
          }
          break;
        }
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open]);

  if (!open) return null;

  const targetType = pixRow?.pix_target_type ?? "grupo";
  const destinationLabel =
    targetType === "numero"
      ? pixRow?.pix_target_number
        ? `Número ${pixRow.pix_target_number}`
        : null
      : binding?.wa_group_name
        ? `Grupo "${binding.wa_group_name}"`
        : null;
  const destinationReady = !!destinationLabel;

  async function removeImage() {
    if (image) {
      await fetch("/api/whatsapp/media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: image.path }),
      });
    }
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (!destinationReady || !pixText.trim() || !image) return;
    if (mode === "schedule" && !scheduleAt) {
      setMsg({ ok: false, text: "Escolha data e hora do disparo." });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pix/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: accountId,
          pix_text: pixText,
          image: { url: image.url, mime: image.mime, fileName: image.fileName },
          schedule_at: mode === "schedule" ? new Date(scheduleAt).toISOString() : undefined,
        }),
      });
      const d = await res.json();
      if (d.error) {
        setMsg({ ok: false, text: d.error });
      } else {
        setMsg({
          ok: true,
          text:
            mode === "schedule"
              ? `Pix programado para ${new Date(scheduleAt).toLocaleString("pt-BR")}.`
              : "Pix enviado!",
        });
        setPixText("");
        setImage(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onSent();
      }
    } catch {
      setMsg({ ok: false, text: "Falha ao enviar o Pix." });
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Enviar Pix — {clientName}</h2>

        <div className="mt-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          <span className="text-xs font-medium text-zinc-500">Destino</span>
          <p className="mt-0.5">
            {loadingBinding ? (
              <span className="text-zinc-500">Carregando…</span>
            ) : destinationReady ? (
              destinationLabel
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Destino não configurado — vá em &quot;Personalizar alertas&quot; (número) ou vincule um grupo em
                Painel → Clientes.
              </span>
            )}
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Texto do Pix (copia e cola)</label>
          <textarea
            value={pixText}
            onChange={(e) => setPixText(e.target.value)}
            rows={3}
            placeholder="Cole aqui o código copia e cola do Pix…"
            className="resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Print do Pix</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
            }}
          />
          {image ? (
            <span className="flex h-8 items-center gap-2 rounded-md border border-zinc-300 px-2 text-xs dark:border-zinc-700">
              📎 <span className="max-w-[220px] truncate">{image.fileName}</span>
              <button onClick={() => void removeImage()} className="font-medium text-red-600">
                Remover
              </button>
            </span>
          ) : (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="h-8 w-fit rounded-md border border-zinc-300 px-2.5 text-xs font-medium disabled:opacity-60 dark:border-zinc-700"
              >
                {uploading ? "Enviando…" : "📎 Anexar print"}
              </button>
              <p className="mt-1 text-xs text-zinc-400">
                Ou tire o print e cole aqui com Ctrl+V (Cmd+V no Mac).
              </p>
            </>
          )}
          {uploadError ? <span className="text-xs text-red-600">{uploadError}</span> : null}
        </div>

        <div className="mt-4 flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "now"} onChange={() => setMode("now")} />
            Enviar agora
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
            Programar
          </label>
        </div>
        {mode === "schedule" ? (
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="mt-2 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        ) : null}

        {msg ? (
          <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}`}>
            {msg.text}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            Fechar
          </button>
          <button
            onClick={() => void submit()}
            disabled={sending || uploading || !destinationReady || !pixText.trim() || !image}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {sending ? "Enviando…" : mode === "schedule" ? "Programar" : "Enviar Pix"}
          </button>
        </div>
      </div>
    </div>
  );
}
