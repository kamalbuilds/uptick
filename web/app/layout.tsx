import type { Metadata } from "next";
import { Archivo, Figtree, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Uptick: put your stock tokens to work",
  description: "Deposit NVDA or GOOGL and earn a share of every trade's fee. Uptick shows what you earn and what you keep after losses to fast traders, and opens a vault only where 5.1 million past trades say it holds up.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${figtree.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
