import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs-nav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-8 pt-8 lg:pt-12">
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-x-12">
        <DocsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
