import type { ReactNode } from "react";

export default function TalkLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[960px] px-6 pb-8 pt-10 lg:pt-14">{children}</div>;
}
