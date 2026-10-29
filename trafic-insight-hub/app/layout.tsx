import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trafic Insight Hub",
  description: "Painel interno de acompanhamento de tráfego pago (Meta Ads).",
  // Etapa 221: app no iPhone ("Adicionar à Tela de Início").
  appleWebApp: { capable: true, title: "Traffic", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
