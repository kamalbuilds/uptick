"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MARKS, monogram, monogramScale } from "@/lib/token-marks";

/** One tile for every token: a light rounded square holding the company's logomark (public/tokens/SOURCES.md says where each came from), or the
 *  ticker as a monogram where the company has no symbol mark. A mark that fails to decode becomes the monogram: a broken image is never shown. */
export function TokenLogo({ symbol, size = 28, className }: { symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const hasMark = MARKS.has(symbol) && !failed;
  // An image that failed before hydration never fires onError on the client, so check the element once on mount.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const text = monogram(symbol, size);
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center bg-fg font-semibold text-canvas", size < 28 ? "rounded-sm" : "rounded-lg", className)}
      style={{ width: size, height: size, fontSize: hasMark ? undefined : Math.round(size * monogramScale(text) * 10) / 10, letterSpacing: "-0.02em" }}
      aria-hidden
    >
      {hasMark ? (
        <img
          ref={img}
          src={`/tokens/${symbol}.png`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-[68%] w-[68%] object-contain"
        />
      ) : (
        text
      )}
    </span>
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
