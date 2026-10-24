"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TERMS, type TermId } from "@/lib/terms";
import { TOOLTIP_GUTTER, TOOLTIP_WIDTH, tooltipShift } from "@/lib/tooltip";
import { cn } from "@/lib/utils";

/** `dx` shifts the tooltip from the left edge of its word so the whole box stays inside the viewport: 0 where it fits, negative near the right edge. */
type Place = { dx: number; y: "below" | "above" };

/** A domain word with a dotted underline and a plain definition. Below lg the invisible ::before gives the trigger a 44px touch target at any text size without moving or resizing the word. The definition opens on hover and on keyboard focus, stays open while the
 *  pointer is over it, and closes on Escape. It stays in the DOM, hidden, so aria-describedby on the focusable trigger always resolves. */
export function Term({ id, children, className }: { id: TermId; children?: React.ReactNode; className?: string }) {
  const tipId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<Place>({ dx: 0, y: "below" });
  const def = TERMS[id];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function show() {
    const r = trigger.current?.getBoundingClientRect();
    // The tooltip hangs from the first line box of the word, which is where an absolutely positioned child of a wrapped inline word starts.
    const anchor = wrap.current?.getClientRects()[0];
    if (r && anchor) {
      setPlace({ dx: tooltipShift(anchor.left, window.innerWidth), y: r.bottom + 150 > window.innerHeight - 48 ? "above" : "below" });
    }
    setOpen(true);
  }

  return (
    <span ref={wrap} className="relative" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button ref={trigger} type="button" aria-describedby={tipId} onFocus={show} onBlur={() => setOpen(false)} className={cn("term relative z-10 inline cursor-help rounded-sm text-left max-lg:before:absolute max-lg:before:left-1/2 max-lg:before:top-1/2 max-lg:before:h-11 max-lg:before:w-[max(100%,2.75rem)] max-lg:before:-translate-x-1/2 max-lg:before:-translate-y-1/2", className)}>
        {children ?? def.label}
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={cn(
          "absolute z-40 rounded-lg border border-line bg-panel px-3 py-2.5 text-left text-[13px] font-normal leading-5 tracking-normal text-fg shadow-[0_8px_24px_rgb(0_0_0/0.5)]",
          open ? "block" : "hidden",
          place.y === "below" ? "top-full mt-2" : "bottom-full mb-2",
        )}
        style={{ left: place.dx, width: `min(${TOOLTIP_WIDTH}px, calc(100vw - ${2 * TOOLTIP_GUTTER}px))` }}
      >
        {def.text}
      </span>
    </span>
  );
}
