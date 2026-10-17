"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CopySimple, Plugs, SignOut, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { addressUrl, robinhoodChain } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { errMessage } from "@/lib/tx";

// Curated EIP-6963 allowlist, in display order. Anything else a browser injects is not offered.
const CURATED = [
  { rdns: "io.rabby", name: "Rabby", install: "https://rabby.io" },
  { rdns: "io.metamask", name: "MetaMask", install: "https://metamask.io/download" },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", install: "https://www.coinbase.com/wallet" },
  { rdns: "com.brave.wallet", name: "Brave Wallet", install: "https://brave.com/wallet" },
] as const;

export function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { connectors, connectAsync, isPending } = useConnect();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function pick(id: string) {
    const connector = connectors.find((c) => c.id === id);
    if (!connector) return;
    setError(null);
    try {
      await connectAsync({ connector, chainId: robinhoodChain.id });
      onClose();
    } catch (err) {
      setError(errMessage(err));
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,26rem)] rounded-xl bg-canvas p-0 text-ink shadow-[0_24px_80px_rgba(14,15,12,0.28)] backdrop:bg-ink/50"
    >
      <div className="p-6">
        <h2 className="text-3xl leading-none">Connect a wallet</h2>
        <p className="mt-2 text-sm text-body">Uptick reads your balance and asks you to sign each transaction. It never holds your keys.</p>
        <ul className="mt-5 divide-y divide-sage-line border-y border-sage-line">
          {CURATED.map((w) => {
            const found = connectors.find((c) => c.id === w.rdns);
            return (
              <li key={w.rdns} className="flex items-center gap-3 py-3">
                {found?.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={found.icon} alt="" width={32} height={32} className="size-8 rounded-md" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-md bg-sage text-sm font-bold" aria-hidden>{w.name[0]}</span>
                )}
                <span className="flex-1 font-semibold">{w.name}</span>
                {found ? (
                  <Button size="sm" variant={w.rdns === "io.rabby" ? "primary" : "soft"} disabled={isPending} onClick={() => pick(found.id)}>
                    {isPending ? "Waiting" : "Connect"}
                  </Button>
                ) : (
                  <a className="text-sm font-semibold underline underline-offset-4 hover:text-ink-deep" href={w.install} target="_blank" rel="noreferrer">
                    Install
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="mt-3 text-sm text-negative-deep">{error}</p>}
        <Button variant="soft" className="mt-5 w-full" onClick={onClose}>Close</Button>
      </div>
    </dialog>
  );
}

export function WalletButton({ size = "md" }: { size?: "sm" | "md" }) {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !isConnected || !address) {
    return (
      <>
        <Button size={size} onClick={() => setPicker(true)}>
          <Plugs size={18} weight="bold" aria-hidden className="hidden sm:block" /> Connect<span className="hidden sm:inline"> wallet</span>
        </Button>
        <WalletPicker open={picker} onClose={() => setPicker(false)} />
      </>
    );
  }

  if (chainId !== robinhoodChain.id) {
    return (
      <Button size={size} variant="dark" disabled={switching} onClick={() => switchChain({ chainId: robinhoodChain.id })}>
        {switching ? "Switching" : "Switch to Robinhood Chain"}
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button size={size} variant="outline" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        <span className="size-2 rounded-full bg-positive" aria-hidden />
        <span className="figure text-sm">{shortAddress(address)}</span>
      </Button>
      {menu && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-sage-line bg-canvas p-1.5 shadow-[0_12px_40px_rgba(14,15,12,0.16)]" onMouseLeave={() => setMenu(false)}>
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sage"
            onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          >
            <CopySimple size={16} aria-hidden /> {copied ? "Copied" : "Copy address"}
          </button>
          <a className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sage" href={addressUrl(address)} target="_blank" rel="noreferrer">
            <ArrowSquareOut size={16} aria-hidden /> View on explorer
          </a>
          <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sage" onClick={() => { disconnect(); setMenu(false); }}>
            <SignOut size={16} aria-hidden /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
