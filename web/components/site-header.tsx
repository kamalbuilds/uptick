"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/vault/nvda", label: "Vaults", match: "/vault" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-sage-line bg-sage/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="display py-2 text-[26px] leading-none sm:text-[28px]" aria-label="Uptick home">Uptick</Link>
        <nav className="ml-1 flex gap-0.5 sm:ml-6 sm:gap-1" aria-label="Primary">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path.startsWith(l.match) ? "page" : undefined}
              className={cn("rounded-full px-2.5 py-2.5 text-sm sm:px-3.5 font-semibold transition-colors duration-150 hover:bg-canvas", path.startsWith(l.match) && "bg-canvas")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto"><WalletButton size="sm" /></div>
      </div>
    </header>
  );
}
