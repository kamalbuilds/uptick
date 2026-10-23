import { Suspense } from "react";
import { IdleFinder } from "@/components/idle-finder";

export const metadata = {
  title: "Find your idle Stock Tokens | Uptick",
  description: "Paste any wallet address. Uptick reads its Stock Token balances from Robinhood Chain and shows what each vault would keep and where a loan opens.",
};

export default function CheckPage() {
  return (
    <Suspense>
      <IdleFinder />
    </Suspense>
  );
}
