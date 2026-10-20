import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs-nav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <DocsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
