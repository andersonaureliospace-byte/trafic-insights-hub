import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trafic Insight Hub",
  description: "Painel interno de acompanhamento de tráfego pago (Meta Ads).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
