import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Frédy Gestão", template: "%s · Frédy Gestão" },
  description: "Gestão comercial, operacional e financeira para agências de viagens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={geist.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster richColors position="top-right" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
