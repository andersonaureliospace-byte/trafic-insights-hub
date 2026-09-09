import type { NextConfig } from "next";

// Toque proposital nesse comentário (09/09) só pra forçar um build 100% novo
// na Vercel, sem reaproveitar cache antigo — algumas rotas novas (Etapa 53/55)
// não tinham entrado no build anterior por causa do cache reaproveitado.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
