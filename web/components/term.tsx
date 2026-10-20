"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TERMS, type TermId } from "@/lib/terms";
import { cn } from "@/lib/utils";

type Place = { x: "left" | "right"; y: "below" | "above" };
const WIDTH = 280;

/** A domain word with a dotted underline and a plain definition. The definition opens on hover and on keyboard focus, stays open while the
 *  pointer is over it, and closes on Escape. It stays in the DOM, hidden, so aria-describedby on the focusable trigger always resolves. */
export function Term({ id, children, className }: { id: TermId; children?: React.ReactNode; className?: string }) {
  const tipId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>({ x: "left", y: "below" });
  const def = TERMS[id];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function show() {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPlace({ x: r.left + WIDTH > window.innerWidth - 12 ? "right" : "left", y: r.bottom + 150 > window.innerHeight - 48 ? "above" : "below" });
    setOpen(true);
  }

  return (
    <span className="relative" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button ref={trigger} type="button" aria-describedby={tipId} onFocus={show} onBlur={() => setOpen(false)} className={cn("term inline cursor-help rounded-sm text-left", className)}>
        {children ?? def.label}
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={cn(
          "absolute z-40 rounded-lg border border-line bg-panel px-3 py-2.5 text-left text-[13px] font-normal leading-5 tracking-normal text-fg shadow-[0_8px_24px_rgb(0_0_0/0.5)]",
          open ? "block" : "hidden",
          place.x === "left" ? "left-0" : "right-0",
          place.y === "below" ? "top-full mt-2" : "bottom-full mb-2",
        )}
        style={{ width: `min(${WIDTH}px, calc(100vw - 24px))` }}
      >
        {def.text}
      </span>
    </span>
  );
}
