import type { MetadataRoute } from "next";

// Etapa 221: app no celular (PWA) — "Adicionar à Tela de Início" no Safari do iPhone abre direto nas telas rápidas (/m).
// Etapa 250: também instalável no computador (Chrome/Edge → "Instalar"). Abre em "/", que manda o celular pra /m e o
// computador pro Hub estratégico (app/page.tsx).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trafic Insight Hub",
    short_name: "Traffic",
    description: "Gestão de tráfego, clientes, feedbacks e alertas.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
