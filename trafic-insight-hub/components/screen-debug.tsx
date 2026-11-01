"use client";

import { useEffect, useState } from "react";

// Etapa 238: medidor de tela (só aparece com ?tela=1 no endereço). Mostra os tamanhos que o navegador está usando —
// pra descobrir por que no iPad a página não ocupa a tela toda. Não muda nada na página.
export function ScreenDebug() {
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("tela")) return;
    const read = () => {
      const de = document.documentElement;
      const vv = window.visualViewport;
      // Elemento mais largo que a página (se houver).
      let widest = "";
      let max = de.clientWidth;
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.right > max + 1) {
          max = r.right;
          widest = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} (${Math.round(r.right)}px)`;
        }
      }
      setInfo(
        [
          `innerWidth ${window.innerWidth} × ${window.innerHeight}`,
          `clientWidth ${de.clientWidth} · scrollWidth ${de.scrollWidth}`,
          `visual ${vv ? `${Math.round(vv.width)} × ${Math.round(vv.height)} · zoom ${vv.scale.toFixed(2)}` : "—"}`,
          `screen ${window.screen.width} × ${window.screen.height} · dpr ${window.devicePixelRatio}`,
          `orientação ${screen.orientation?.type ?? (window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait")}`,
          `standalone ${window.matchMedia("(display-mode: standalone)").matches ? "sim" : "não"}`,
          `mais largo: ${widest || "nenhum"}`,
          `UA ${navigator.userAgent.slice(0, 90)}`,
        ].join("\n"),
      );
    };
    read();
    const t = setInterval(read, 1500);
    window.addEventListener("resize", read);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", read);
    };
  }, []);

  if (!info) return null;
  return (
    <pre className="fixed bottom-2 left-2 z-[100] max-w-[90vw] whitespace-pre-wrap rounded-md bg-yellow-300 p-2 text-[11px] leading-tight text-black shadow-lg">
      {info}
    </pre>
  );
}
