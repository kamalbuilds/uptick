"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/vaults", label: "Vaults", match: "/vault" },
  { href: "/check", label: "Check a wallet", match: "/check" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
  { href: "/docs", label: "Docs", match: "/docs" },
  { href: "/research", label: "Research", match: "/research" },
  { href: "/talk", label: "Talk to us", match: "/talk" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 px-6 sm:h-16 sm:flex-nowrap">
        <Link href="/" className="py-3.5 text-xl font-semibold tracking-[-0.4px] sm:py-0" aria-label="Uptick home">Uptick</Link>
        <nav className="order-3 -mb-px -mx-2 flex w-[calc(100%+1rem)] gap-6 overflow-x-auto px-2 [scrollbar-width:none] sm:order-none sm:mx-0 sm:mb-0 sm:w-auto sm:px-0" aria-label="Primary">
          {links.map((l) => {
            const active = path.startsWith(l.match);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn("touch press flex h-11 items-center whitespace-nowrap border-b-2 text-[15px] sm:h-16", active ? "border-fg text-fg" : "border-transparent text-mute hover:text-fg")}
              >
                {l.label}
              </Link>
            );
          })}
          <a href="/deck/" className="touch press flex h-11 items-center whitespace-nowrap border-b-2 border-transparent text-[15px] text-mute hover:text-fg sm:h-16">Deck</a>
        </nav>
        <div className="ml-auto"><WalletButton size="sm" /></div>
      </div>
    </header>
  );
}
