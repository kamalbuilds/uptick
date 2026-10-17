import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("shimmer block rounded-md", className)} aria-hidden />;
}

export function FetchError({ what, onRetry, dark }: { what: string; onRetry: () => void; dark?: boolean }) {
  return (
    <div role="alert" className={`flex flex-col items-start gap-3 rounded-lg p-4 ${dark ? "bg-canvas/10 text-canvas" : "bg-sage text-ink"}`}>
      <p className="font-semibold">The stats API did not answer for {what}.</p>
      <p className={`text-sm ${dark ? "text-sage" : "text-body"}`}>No stand-in figure is shown. Retry asks again.</p>
      <Button size="sm" variant={dark ? "primary" : "dark"} onClick={onRetry}>Retry</Button>
    </div>
  );
}
