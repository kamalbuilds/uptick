"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { Kept, StateChip } from "./ledger";
import { WalletButton } from "./wallet-button";
import { YourLoans } from "./your-loan";
import { Skeleton } from "./status";
import { vaultAbi } from "@/lib/abis";
import { addressUrl, robinhoodChain } from "@/lib/chain";
import { num, shortAddress } from "@/lib/format";
import { SHARE_DECIMALS, VAULTS, type VaultConfig } from "@/lib/vaults";

function PositionRow({ cfg, owner }: { cfg: VaultConfig; owner: `0x${string}` }) {
  const vault = cfg.vault;
  const r = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(vault), refetchInterval: 20_000 },
    contracts: vault ? [{ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [owner], chainId: robinhoodChain.id }] : [],
  });
  const sharesRaw = r.data?.[0];
  const conv = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(vault && sharesRaw && sharesRaw > 0n) },
    contracts: vault && sharesRaw ? [{ address: vault, abi: vaultAbi, functionName: "convertToAssets", args: [sharesRaw], chainId: robinhoodChain.id }] : [],
  });

  const shares = sharesRaw !== undefined ? Number(formatUnits(sharesRaw, SHARE_DECIMALS)) : undefined;
  const assets = conv.data?.[0] !== undefined ? Number(formatUnits(conv.data[0], 18)) : undefined;

  return (
    <li className="grid grid-cols-2 items-center gap-x-6 gap-y-3 border-b border-hairline py-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_72px_auto]">
      <div>
        <p className="text-[17px] font-semibold">{cfg.symbol}</p>
        {vault && <a className="figure text-[13px] text-mute underline underline-offset-4" href={addressUrl(vault)} target="_blank" rel="noreferrer">{shortAddress(vault)}</a>}
      </div>
      {r.isLoading ? (
        <Skeleton className="col-span-2 h-10 sm:col-span-2" />
      ) : r.isError ? (
        <p role="alert" className="col-span-2 text-loss sm:col-span-2">The chain did not answer for this vault. <button className="underline" onClick={() => r.refetch()}>Retry</button></p>
      ) : (
        <>
          <Metric k="Shares" v={shares !== undefined ? num(shares, 6) : "n/a"} />
          <Metric k={`Worth in ${cfg.symbol}`} v={assets !== undefined ? num(assets, 6) : shares === 0 ? "0" : "n/a"} />
        </>
      )}
      <div className="text-right sm:text-left">
        <Kept value={cfg.gate.worstHalfApr} className="text-[15px] font-medium" />
        <p className="text-[12px] text-mute">worst half</p>
      </div>
      <Button asChild variant="outline" size="sm" className="justify-self-end">
        <Link href={`/vault/${cfg.id}`}>Manage</Link>
      </Button>
    </li>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="figure text-[17px] font-medium">{v}</p>
      <p className="text-[13px] text-mute">{k}</p>
    </div>
  );
}

export function Portfolio() {
  const { address, isConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const live = VAULTS.filter((v) => v.vault);
  const opening = VAULTS.filter((v) => !v.vault);

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-8 pt-10 lg:pt-14">
      <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">Your positions</h1>
      {!mounted ? (
        <Skeleton className="mt-8 h-40 w-full" />
      ) : !isConnected || !address ? (
        <div className="mt-8 max-w-lg border-t border-hairline pt-6">
          <p className="serif text-[26px] leading-8">Connect a wallet to see its vault shares and loans.</p>
          <p className="mt-3 text-mute">Balances are read straight from Robinhood Chain. Nothing is stored on a server.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <WalletButton size="lg" />
            <Link href="/check" className="text-[15px] font-semibold underline underline-offset-4">Or check any address</Link>
          </div>
        </div>
      ) : chainId !== robinhoodChain.id ? (
        <div className="mt-8 max-w-lg border-t border-hairline pt-6">
          <p className="serif text-[26px] leading-8">Your wallet is on another network.</p>
          <div className="mt-6"><WalletButton size="lg" /></div>
        </div>
      ) : (
        <>
          <p className="figure mt-2 text-mute">{shortAddress(address)}</p>
          {live.length > 0 && <ul className="mt-8 border-t border-hairline">{live.map((v) => <PositionRow key={v.id} cfg={v} owner={address} />)}</ul>}
          <YourLoans cfgs={live} className="mt-12" />
          {opening.length > 0 && (
            <section className="mt-12" aria-labelledby="opening">
              <h2 id="opening" className="border-b border-hairline pb-3 text-2xl font-semibold leading-8 tracking-[-0.2px]">Opening</h2>
              <p className="mt-4 max-w-[690px] text-mute">A position appears here after your first deposit into one of these vaults.</p>
              <ul className="mt-2">
                {opening.map((v) => (
                  <li key={v.id}>
                    <Link href={`/vault/${v.id}`} className="row flex min-h-12 items-center justify-between gap-4 border-b border-hairline py-2">
                      <span className="font-semibold">{v.symbol}</span>
                      <span className="flex items-center gap-4"><Kept value={v.gate.worstHalfApr} /><StateChip state={v.gate.state} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
