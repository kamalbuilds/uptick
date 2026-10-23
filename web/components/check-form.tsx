"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { parseOwner } from "@/lib/scan";
import { cn } from "@/lib/utils";

/** Paste any 0x address and open /check for it. Nothing is connected or signed. A connected wallet's address fills the field when it is empty. */
export function CheckForm({ initial = "", className, stacked }: { initial?: string; className?: string; /** Field above button at every width, for a narrow column. */ stacked?: boolean }) {
  const router = useRouter();
  const id = useId();
  const { address: connected } = useAccount();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (connected) setValue((v) => (v === "" ? connected : v));
  }, [connected]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const owner = parseOwner(value);
    if (!owner) {
      setError("That is not a wallet address. Paste the 42-character 0x address, not a name.");
      return;
    }
    setError(undefined);
    router.push(`/check?address=${owner}`);
  }

  return (
    <form onSubmit={submit} className={className} noValidate>
      <label htmlFor={id} className="text-[13px] leading-5 text-mute">Wallet address</label>
      <div className={cn("mt-1 flex flex-col gap-3", !stacked && "sm:flex-row")}>
        <input
          id={id}
          name="address"
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(undefined); }}
          placeholder="0x..."
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn("figure h-12 w-full min-w-0 rounded-lg border bg-panel px-4 text-[13px] outline-none placeholder:text-mute focus:border-fg min-[420px]:text-[15px]", !stacked && "sm:w-auto sm:flex-1", error ? "border-loss" : "border-line")}
        />
        <Button type="submit" size="lg">Find idle tokens</Button>
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="mt-2 text-[13px] leading-5 text-loss">{error}</p> : null}
    </form>
  );
}
