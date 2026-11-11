import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "GENY PRO | AI Trading Mentor & Command Center — INGRESARIOS",
  description:
    "Plataforma central de GENY PRO: Mentora de trading, psicotrading y método PEDEM conectada a Telegram, WhatsApp y Web.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[#06070B] text-slate-100 antialiased selection:bg-violet-500/30 selection:text-violet-100">
        {children}
      </body>
    </html>
  );
}
