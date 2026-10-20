"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/vaults", label: "Vaults", match: "/vault" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
  { href: "/docs", label: "Docs", match: "/docs" },
  { href: "/research", label: "Research", match: "/research" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-sage-line bg-sage/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 sm:h-16 sm:flex-nowrap sm:gap-4 sm:px-6 sm:py-0">
        <Link href="/" className="display py-2 text-[26px] leading-none sm:text-[28px]" aria-label="Uptick home">Uptick</Link>
        <nav
          className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto pb-1 sm:order-none sm:mx-0 sm:ml-6 sm:w-auto sm:gap-1 sm:overflow-visible sm:pb-0"
          aria-label="Primary"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path.startsWith(l.match) ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150 hover:bg-canvas sm:px-3.5 sm:py-2.5 sm:text-sm", path.startsWith(l.match) && "bg-canvas")}
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
