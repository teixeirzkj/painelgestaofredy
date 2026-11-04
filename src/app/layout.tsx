import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Frédy Gestão", template: "%s · Frédy Gestão" },
  description: "Gestão comercial, operacional e financeira para agências de viagens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster richColors position="top-right" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
