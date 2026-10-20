"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A token's mark from /tokens/<SYMBOL>.png (public/tokens/SOURCES.md lists where each file came from). A file that is missing or fails to
 *  decode becomes a monogram chip: a broken image is never shown. */
export function TokenLogo({ symbol, size = 28, className }: { symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError on the client, so check the element once on mount.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const box = { width: size, height: size };
  if (failed) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-fg", className)}
        style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.36)) }}
        aria-hidden
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      ref={img}
      src={`/tokens/${symbol}.png`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full", className)}
      style={box}
    />
  );
}

/** A vault's pair: the Stock Token over USDG, overlapped the way a pool pair reads on Kamino and Saffron. */
export function PairLogo({ symbol, size = 28 }: { symbol: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden>
      <TokenLogo symbol={symbol} size={size} className="ring-2 ring-canvas" />
      <TokenLogo symbol="USDG" size={size} className="-ml-2.5 ring-2 ring-canvas" />
    </span>
  );
}
