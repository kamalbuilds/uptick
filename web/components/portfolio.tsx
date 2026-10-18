"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { WalletButton } from "./wallet-button";
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
    <li className="grid grid-cols-2 items-center gap-x-6 gap-y-3 py-5 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
      <div>
        <p className="display text-3xl">{cfg.symbol}</p>
        {vault && <a className="figure text-xs text-body underline underline-offset-4" href={addressUrl(vault)} target="_blank" rel="noreferrer">{shortAddress(vault)}</a>}
      </div>
      {!vault ? (
        <p className="col-span-2 text-body sm:col-span-2">Opening. Your position appears here after your first deposit.</p>
      ) : r.isLoading ? (
        <Skeleton className="col-span-2 h-10 sm:col-span-2" />
      ) : r.isError ? (
        <p role="alert" className="col-span-2 text-negative-deep sm:col-span-2">The chain did not answer for this vault. <button className="underline" onClick={() => r.refetch()}>Retry</button></p>
      ) : (
        <>
          <Metric k="Shares" v={shares !== undefined ? num(shares, 6) : "n/a"} />
          <Metric k={`Worth in ${cfg.symbol}`} v={assets !== undefined ? num(assets, 6) : shares === 0 ? "0" : "n/a"} />
        </>
      )}
      <Button asChild variant="soft" size="sm" className="justify-self-start sm:justify-self-end">
        <Link href={`/vault/${cfg.id}`}>Manage</Link>
      </Button>
    </li>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="figure text-lg font-medium">{v}</p>
      <p className="text-xs text-body">{k}</p>
    </div>
  );
}

export function Portfolio() {
  const { address, isConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-10 sm:px-6 lg:pt-16">
      <h1 className="display text-[clamp(3rem,8vw,6rem)]">Your positions</h1>
      {!mounted ? (
        <Skeleton className="mt-8 h-40 w-full" />
      ) : !isConnected || !address ? (
        <div className="mt-8 max-w-lg rounded-xl bg-canvas p-6 sm:p-8">
          <p className="text-xl font-semibold">Connect a wallet to see the vault shares it holds.</p>
          <p className="mt-2 text-body">Balances are read straight from Robinhood Chain. Nothing is stored on a server.</p>
          <div className="mt-5"><WalletButton /></div>
        </div>
      ) : chainId !== robinhoodChain.id ? (
        <div className="mt-8 max-w-lg rounded-xl bg-canvas p-6 sm:p-8">
          <p className="text-xl font-semibold">Your wallet is on another network.</p>
          <div className="mt-5"><WalletButton /></div>
        </div>
      ) : (
        <>
          <p className="figure mt-3 text-sm text-body">{shortAddress(address)}</p>
          <ul className="mt-8 divide-y divide-sage-line border-y border-sage-line">
            {VAULTS.map((v) => <PositionRow key={v.id} cfg={v} owner={address} />)}
          </ul>
        </>
      )}
    </div>
  );
}
