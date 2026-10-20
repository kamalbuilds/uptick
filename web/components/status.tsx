import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("shimmer block rounded-lg", className)} aria-hidden />;
}

export function FetchError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-line p-4">
      <p className="font-semibold">The stats API did not answer for {what}.</p>
      <p className="text-[13px] text-mute">Every figure here is read live. Retry asks again.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}
