import type { Metadata } from "next";
import { Hanken_Grotesk, Literata } from "next/font/google";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PriceTicker } from "@/components/price-ticker";
import { pitchLine } from "@/lib/format";
import { REPLAYED_SWAPS, VAULTS } from "@/lib/vaults";
import "./globals.css";

const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-hanken", display: "swap" });
const literata = Literata({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-literata", display: "swap" });

export const metadata: Metadata = {
  title: "Uptick: put your stock tokens to work",
  description: pitchLine(VAULTS.length, REPLAYED_SWAPS),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${literata.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
          <PriceTicker />
        </Providers>
      </body>
    </html>
  );
}
