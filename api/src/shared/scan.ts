import { formatUnits, getAddress, isAddress, parseAbi, type Address, type PublicClient } from "viem";
import { feedUsd } from "./price-math.ts";

/** The wallet scan behind the web page /check and the MCP tool scan_wallet. web/lib/scan.ts is the one source: `npm run sync` in api/ copies it
 *  (with price-math.ts and morpho.ts) into api/src/shared, and api/test/shared-sync.test.ts fails when the copies differ. */

export const STOCK_DECIMALS = 18;

/** Multicall3 at its canonical address; Robinhood Chain has it deployed (eth_getCode is non-empty). */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Keyless public RPCs for Robinhood Chain (4663) that answer JSON-RPC batches, probed 2026-10-17 and answering CORS preflights 2026-10-23.
 *  The official endpoint is last because it answers 429 to shared egress such as Cloudflare Workers; a browser puts its own choice first. */
export const RHC_RPCS = [
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://rpc.ordofi.network",
  "https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public",
  "https://api.blockvectra.com/v1/robinhood_mainnet/public",
  "https://robinhood.daybreak-rpc.network",
  "https://rpc.mainnet.chain.robinhood.com",
] as const;

const erc20BalanceAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
/** ERC-4626 maxDeposit: StockVault returns its deposit cap less the assets in it, and 0 while it is paused. */
const maxDepositAbi = parseAbi(["function maxDeposit(address receiver) view returns (uint256)"]);
const UNCAPPED = 2n ** 256n - 1n;
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export type GateState = "open" | "reduced" | "closed";

/** What a scan needs to know about one tracked Stock Token. `depositCapUsd` is the vault's size; `vault` is its deployed address, absent while it is launching. */
export type ScanVault = {
  id: string;
  symbol: string;
  name: string;
  token: Address;
  vault?: Address;
  feed: Address;
  entryFeeBps: number;
  depositCapUsd: number;
  gate: { state: GateState; reason: string; worstHalfApr: number };
};

/** Loan-to-value limit per vault id, in Morpho's 1e18 scale, for every vault with a configured collateral market. */
export type ScanLltv = Record<string, bigint>;

/** A pasted wallet address as its checksummed form, or null. All-lowercase and correctly checksummed forms pass; a mixed-case address with a wrong checksum, a name such as vitalik.eth, and anything not 20 bytes of hex do not. */
export function parseOwner(raw: string): Address | null {
  const s = raw.trim();
  return isAddress(s) ? getAddress(s) : null;
}

// ---- the math ------------------------------------------------------------------------------------------------------------------------

/** A raw token balance at a USD price. */
export const holdingUsd = (balance: bigint, decimals: number, priceUsd: number): number => Number(formatUnits(balance, decimals)) * priceUsd;

/** The part of a holding a vault takes: the holding, or the vault's size when that is smaller. */
export const placeableUsd = (holding: number, depositCapUsd: number): number => Math.min(holding, depositCapUsd);

/** What a deposit of `usd` is worth once the vault keeps its entry fee: the base every yearly figure is earned on (same as the deposit ticket). */
export const netOfFee = (usd: number, entryFeeBps: number): number => (usd * (10_000 - entryFeeBps)) / 10_000;

/** Dollars a year the amount keeps at the gate's weaker-half kept APR (percent a year). Signed: a negative weaker half is a loss. */
export const keptPerYearUsd = (usd: number, entryFeeBps: number, worstHalfAprPct: number): number => (netOfFee(usd, entryFeeBps) * worstHalfAprPct) / 100;

/** Dollars borrowable against the deposit's vault shares at the market's loan-to-value limit (lltv in 1e18). The shares are worth the deposit net of the entry fee. */
export const borrowRoomUsd = (usd: number, entryFeeBps: number, lltv: bigint): number => (netOfFee(usd, entryFeeBps) * Number((lltv * 1_000_000n) / 10n ** 18n)) / 1_000_000;

// ---- the scan ------------------------------------------------------------------------------------------------------------------------

export type Borrow =
  /** A Morpho collateral market is configured: the most the shares can back at the market's limit. */
  | { kind: "room"; usd: number; lltv: number }
  /** No market is configured for this vault yet. */
  | { kind: "opens-with-market" }
  /** The vault is closed, so no shares exist to post. */
  | { kind: "none" };

export type ScanRow = {
  id: string;
  symbol: string;
  name: string;
  token: Address;
  /** Wallet balance in tokens, as a decimal string, and in base units. */
  balance: string;
  balanceRaw: bigint;
  /** Chainlink USD price of the token and the unix second of the round it was read from. Null when the feed answered no usable round. */
  priceUsd: number | null;
  priceUpdatedAt: number | null;
  holdingUsd: number | null;
  state: GateState;
  /** The gate's own sentence for the state. */
  reason: string;
  worstHalfApr: number;
  entryFeeBps: number;
  depositCapUsd: number;
  /** The deployed vault, or null while it is launching. */
  vault: Address | null;
  /** What a live vault takes from this wallet right now: its own maxDeposit (the cap less what is in it, 0 when paused) at the token's price. Null while the vault is launching,
   *  when the read failed, when the vault has no cap, or when the token is unpriced; `putToWorkUsd` then falls back to the vault's size. */
  roomUsd: number | null;
  /** The part of the holding the vault takes: the holding, or the room the vault has, whichever is smaller (its size while the room is unknown). Null for a closed vault or an unpriced token. */
  putToWorkUsd: number | null;
  /** Dollars a year at the weaker-half kept APR on `putToWorkUsd` net of the entry fee. Null when `putToWorkUsd` is. */
  keptPerYearUsd: number | null;
  borrow: Borrow;
};

export type WalletScan = {
  owner: Address;
  /** The block the Multicall3 call ran at, and the wall-clock ms the answer arrived. */
  block: bigint;
  readAt: number;
  /** Tokens the wallet holds, largest holding first; unpriced ones last. */
  rows: ScanRow[];
  tracked: number;
  totals: {
    /** Value of every priced Stock Token in the wallet. */
    idleUsd: number;
    /** Open and reduced tokens the vaults take. `usd` is the part they take (the room caps it), `holdingUsd` the whole holding. `live` and `launching` split `usd` by whether the vault is deployed,
     *  so a headline and a ticket read the same two figures; `full` names live vaults that take nothing now because they are at their cap or paused. */
    putToWork: {
      tokens: number;
      usd: number;
      holdingUsd: number;
      keptPerYearUsd: number;
      borrowRoomUsd: number | null;
      live: { usd: number; symbols: string[] };
      launching: { usd: number; symbols: string[] };
      full: string[];
    };
    /** Closed tokens, with the gate's reason for each. */
    refused: { tokens: number; usd: number; reasons: Array<{ symbol: string; reason: string }> };
    /** Held tokens whose Chainlink feed answered no usable round: counted in no dollar total. */
    unpriced: string[];
  };
};

/** The two methods a scan uses. A viem PublicClient satisfies it. */
export type ScanClient = Pick<PublicClient, "multicall" | "getBlockNumber">;

/** Robinhood Chain makes about ten blocks a second and the public nodes in the fallback list sit up to ten blocks apart. The scan reads at the head less this many
 *  blocks, about three seconds back, so whichever node answers has that block, and the block shown is the block read. (Multicall3.getBlockNumber is not used:
 *  on an Arbitrum chain a contract's block.number is the parent chain's, 26 million here against 95 million for the chain.) */
export const READ_LAG = 32n;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];

/** One Multicall3 call, pinned to one block, reads every tracked token's balance of `owner`, every Chainlink round and decimals, and each live vault's maxDeposit. `batchSize` is raised
 *  so viem sends one `eth_call`. A call that fails is a row left unpriced, never defaulted; a balance that fails is an error, because an unread balance
 *  is not a zero. */
export async function scanWallet(client: ScanClient, owner: Address, vaults: readonly ScanVault[], lltvById: ScanLltv = {}): Promise<WalletScan> {
  const block = (await client.getBlockNumber()) - READ_LAG;
  const live = vaults.filter((v) => v.vault !== undefined);
  const contracts = [
    ...vaults.map((v) => ({ address: v.token, abi: erc20BalanceAbi, functionName: "balanceOf" as const, args: [owner] as const })),
    ...vaults.flatMap((v) => [
      { address: v.feed, abi: feedAbi, functionName: "latestRoundData" as const },
      { address: v.feed, abi: feedAbi, functionName: "decimals" as const },
    ]),
    ...live.map((v) => ({ address: v.vault as Address, abi: maxDepositAbi, functionName: "maxDeposit" as const, args: [owner] as const })),
  ];
  const res = await client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 1 << 20, blockNumber: block });

  const rows: ScanRow[] = [];
  vaults.forEach((v, i) => {
    const bal = res[i];
    if (bal.status !== "success") throw new Error(`balanceOf failed for ${v.symbol}`);
    const balanceRaw = bal.result as bigint;
    if (balanceRaw <= 0n) return;

    const round = res[vaults.length + 2 * i];
    const dec = res[vaults.length + 2 * i + 1];
    let priceUsd: number | null = null;
    let priceUpdatedAt: number | null = null;
    if (round.status === "success" && dec.status === "success") {
      const [, answer, , updatedAt] = round.result as Round;
      priceUsd = feedUsd(answer, Number(dec.result));
      if (priceUsd !== null) priceUpdatedAt = Number(updatedAt);
    }

    const holding = priceUsd === null ? null : holdingUsd(balanceRaw, STOCK_DECIMALS, priceUsd);
    const taken = v.gate.state !== "closed" && holding !== null;
    // The room a live vault has today. A launching vault, an unreadable call and an uncapped vault leave it unknown, and the vault's size stands in.
    const roomCall = v.vault === undefined ? undefined : res[3 * vaults.length + live.indexOf(v)];
    const roomRaw = roomCall?.status === "success" ? (roomCall.result as bigint) : undefined;
    const roomUsd = roomRaw === undefined || roomRaw === UNCAPPED || priceUsd === null ? null : holdingUsd(roomRaw, STOCK_DECIMALS, priceUsd);
    const put = taken ? placeableUsd(holding, roomUsd ?? v.depositCapUsd) : null;
    const lltv = lltvById[v.id];
    rows.push({
      id: v.id,
      symbol: v.symbol,
      name: v.name,
      token: v.token,
      balance: formatUnits(balanceRaw, STOCK_DECIMALS),
      balanceRaw,
      priceUsd,
      priceUpdatedAt,
      holdingUsd: holding,
      state: v.gate.state,
      reason: v.gate.reason,
      worstHalfApr: v.gate.worstHalfApr,
      entryFeeBps: v.entryFeeBps,
      depositCapUsd: v.depositCapUsd,
      vault: v.vault ?? null,
      roomUsd,
      putToWorkUsd: put,
      keptPerYearUsd: put === null ? null : keptPerYearUsd(put, v.entryFeeBps, v.gate.worstHalfApr),
      borrow: v.gate.state === "closed" ? { kind: "none" } : lltv !== undefined && put !== null ? { kind: "room", usd: borrowRoomUsd(put, v.entryFeeBps, lltv), lltv: Number((lltv * 10_000n) / 10n ** 18n) / 100 } : { kind: "opens-with-market" },
    });
  });
  rows.sort((a, b) => (b.holdingUsd ?? -1) - (a.holdingUsd ?? -1));

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const priced = rows.filter((r) => r.holdingUsd !== null);
  const taking = rows.filter((r) => r.state !== "closed" && r.putToWorkUsd !== null);
  // A live vault at its cap or paused takes nothing now: it is listed as full, not as working.
  const working = taking.filter((r) => (r.putToWorkUsd as number) > 0);
  const inVault = (live: boolean) => working.filter((r) => (r.vault !== null) === live);
  const refused = priced.filter((r) => r.state === "closed");
  const rooms = working.map((r) => (r.borrow.kind === "room" ? r.borrow.usd : null));
  return {
    owner,
    block,
    readAt: Date.now(),
    rows,
    tracked: vaults.length,
    totals: {
      idleUsd: sum(priced.map((r) => r.holdingUsd as number)),
      putToWork: {
        tokens: working.length,
        usd: sum(working.map((r) => r.putToWorkUsd as number)),
        holdingUsd: sum(working.map((r) => r.holdingUsd as number)),
        keptPerYearUsd: sum(working.map((r) => r.keptPerYearUsd as number)),
        // A total only when every working row has a market: a partial sum would read as the whole.
        borrowRoomUsd: rooms.length > 0 && rooms.every((x) => x !== null) ? sum(rooms as number[]) : null,
        live: { usd: sum(inVault(true).map((r) => r.putToWorkUsd as number)), symbols: inVault(true).map((r) => r.symbol) },
        launching: { usd: sum(inVault(false).map((r) => r.putToWorkUsd as number)), symbols: inVault(false).map((r) => r.symbol) },
        full: taking.filter((r) => r.vault !== null && r.putToWorkUsd === 0).map((r) => r.symbol),
      },
      refused: { tokens: refused.length, usd: sum(refused.map((r) => r.holdingUsd as number)), reasons: refused.map((r) => ({ symbol: r.symbol, reason: r.reason })) },
      unpriced: rows.filter((r) => r.holdingUsd === null).map((r) => r.symbol),
    },
  };
}
