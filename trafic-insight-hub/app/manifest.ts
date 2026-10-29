import type { MetadataRoute } from "next";

// Etapa 221: app no celular (PWA) — "Adicionar à Tela de Início" no Safari do iPhone abre direto nas telas rápidas (/m).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trafic Insight Hub",
    short_name: "Traffic",
    description: "Alertas, clientes e conjuntos — versão de celular do Trafic Insight Hub.",
    start_url: "/m",
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
