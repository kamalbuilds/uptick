import type { Metadata } from "next";
import { Hanken_Grotesk, Literata } from "next/font/google";
import "./lab.css";

const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-hanken", display: "swap" });
const literata = Literata({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-literata", display: "swap" });

export const metadata: Metadata = { title: "Uptick lab: first-screen directions", robots: { index: false } };

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div className={`lab ${hanken.variable} ${literata.variable}`}>{children}</div>;
}
