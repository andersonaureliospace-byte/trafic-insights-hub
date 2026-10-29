import type { NextConfig } from "next";

// Toque proposital nesse comentário (09/09) só pra forçar um build 100% novo
// na Vercel, sem reaproveitar cache antigo — algumas rotas novas (Etapa 53/55)
// não tinham entrado no build anterior por causa do cache reaproveitado.
const nextConfig: NextConfig = {
  // Etapa 221: service worker do app no celular — nunca em cache (assim cada deploy já vale no iPhone).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
