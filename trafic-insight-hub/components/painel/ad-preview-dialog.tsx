"use client";

import { useEffect, useState } from "react";

// Etapa 229: prévia do anúncio como aparece no Facebook/Instagram (a Meta monta a imagem; aqui só mostra).
const FORMATS = [
  { id: "MOBILE_FEED_STANDARD", label: "Feed Facebook", w: 340, h: 600 },
  { id: "INSTAGRAM_STANDARD", label: "Feed Instagram", w: 340, h: 600 },
  { id: "INSTAGRAM_STORY", label: "Stories", w: 330, h: 640 },
  { id: "INSTAGRAM_REELS", label: "Reels", w: 330, h: 640 },
] as const;

const cache = new Map<string, { src: string } | { error: string }>();

export function AdPreviewDialog({ adId, name, onClose }: { adId: string; name: string; onClose: () => void }) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("MOBILE_FEED_STANDARD");
  const key = `${adId}|${format}`;
  const [, force] = useState(0);
  const v = cache.get(key);

  useEffect(() => {
    if (cache.has(key)) return;
    let cancelled = false;
    fetch("/api/analysis/ad-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId, format }),
    })
      .then((r) => r.json())
      .then((d: { src?: string; error?: string }) => {
        cache.set(key, d.src ? { src: d.src } : { error: d.error ?? "Sem prévia." });
        if (!cancelled) force((n) => n + 1);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          cache.set(key, { error: e.message });
          force((n) => n + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adId, format, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const f = FORMATS.find((x) => x.id === format)!;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50" title={name}>
            Prévia · {name}
          </span>
          <button onClick={onClose} className="h-7 px-2 text-sm text-zinc-500" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {FORMATS.map((x) => (
            <button
              key={x.id}
              onClick={() => setFormat(x.id)}
              className={`h-7 rounded-full px-2.5 text-xs font-medium ${
                format === x.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 justify-center overflow-auto bg-zinc-100 p-3 dark:bg-zinc-950">
          {!v ? (
            <p className="py-10 text-sm text-zinc-500">Carregando a prévia…</p>
          ) : "error" in v ? (
            <p className="py-10 text-center text-sm text-red-600">{v.error}</p>
          ) : (
            <iframe
              key={v.src}
              src={v.src}
              title={`Prévia ${f.label}`}
              width={f.w}
              height={f.h}
              className="shrink-0 rounded-md border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          )}
        </div>
      </div>
    </div>
  );
}
