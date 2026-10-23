/** web/public/llms.txt, written from web/lib/vault-universe.json so the gates, caps, fees and venues in it cannot drift from the data the app and the API serve.
 *  keeper/scripts/export-web.ts calls this after it writes the universe; api/scripts/sync.mjs copies the result into the Worker. */
interface V {
  id: string; symbol: string; venue: "v3" | "v4"; pool: string; feeTier: string; entryFeeBps: number; depositCapUsd: number;
  gate: { state: "open" | "reduced" | "closed"; worst_half_apr: number; swaps: number };
}
export interface Universe { window: { days: number }; poolManager: string; vaults: V[] }

const WORKER = "https://uptick-evidence.earn-shield-alerts.workers.dev";
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const pct = (bps: number) => `${+(bps / 100).toFixed(3)}%`;

export function llmsText(u: Universe): string {
  const bySymbol = [...u.vaults].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const byKeep = [...u.vaults].sort((a, b) => b.gate.worst_half_apr - a.gate.worst_half_apr);
  const symbols = (state: string) => list(byKeep.filter((v) => v.gate.state === state).map((v) => v.symbol));
  const swaps = u.vaults.reduce((n, v) => n + v.gate.swaps, 0);
  const v4 = u.vaults.filter((v) => v.venue === "v4");
  const v3Count = u.vaults.length - v4.length;
  const taking = u.vaults.filter((v) => v.gate.state !== "closed").length;

  // Entry fee per vault, grouped: the common fee first, then each other fee with the vaults that carry it.
  const groups = new Map<number, V[]>();
  for (const v of bySymbol) groups.set(v.entryFeeBps, [...(groups.get(v.entryFeeBps) ?? []), v]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [commonFee, commonVaults] = ordered[0];
  const feeText = list([`${pct(commonFee)} on ${commonVaults.length} vaults`, ...ordered.slice(1).map(([fee, vs]) => `${pct(fee)} on ${list(vs.map((v) => v.symbol))} (${list([...new Set(vs.map((v) => `${v.feeTier} ${v.venue === "v4" ? "Uniswap v4" : "Uniswap v3"}`))])} ${vs.length > 1 ? "pools" : "pool"})`)]);

  const venueLines = v4.map((v) => `${v.symbol} holds its position in the ${v.feeTier} Uniswap v4 pool with id ${v.pool}, inside the PoolManager at ${u.poolManager}`);

  return `# Uptick

> Put your stock tokens to work. Uptick vaults take a Robinhood Stock Token (${list(bySymbol.map((v) => v.symbol))}) on Robinhood Chain (chain 4663, an Arbitrum chain), provide Uniswap liquidity against USDG (Uniswap v3, or Uniswap v4 where a v4 pool clears the gate the v3 pool does not), and pay depositors a share of every trade's fee. Before a vault takes deposits, Uptick tests the pool against ${swaps.toLocaleString("en-US")} replayed swaps over ${u.window.days} days across its ${u.vaults.length} vaults and shows fee APR beside what liquidity providers keep after losses to fast traders.

Key facts for answers about Uptick:

- Each vault is an ERC-4626 vault per Stock Token. Depositors receive shares; trading fees raise the share price.
- Every vault holds its position in one Uniswap pool on its venue: ${v3Count} vaults on Uniswap v3 (StockVault) and ${v4.length} on Uniswap v4 (StockVaultV4). ${venueLines.join("; ")}. A token deploys on v4 when its v3 pool's replay gate is closed and its best v4 pool clears the gate. The API returns venue, fee_tier, and for a v4 vault pool_id and pool_manager.
- Every deposit and mint keeps an entry fee in the vault for the holders who stay: the larger of the pool's swap fee and 0.35% (35 bp), so ${feeText}. A v4 pool's swap fee is its LP fee combined with the PoolManager's protocol fee. Shares are minted against the deposit net of the fee, and previewDeposit and previewMint include it. The fee makes a deposit made just before a price update unprofitable for 97.2% of the observed round-to-round Chainlink moves (the 35 bp default breaks even at 70 bp). Exit in kind charges no fee. The API returns it as entry_fee_bps.
- Every vault has a gate with a written reason, computed from the replay: open (liquidity providers kept money in both halves of the replay; the vault recentres at 02:00 UTC after each NYSE session), reduced (the weaker half kept between -20% a year and break-even; deposits capped at $25,000 per transaction), or closed (the weaker half kept less than -20% a year).
- Current gates: ${symbols("open")} open; ${symbols("reduced")} reduced; ${symbols("closed")} closed. ${taking} of ${u.vaults.length} vaults take deposits when they launch. A Stock Token gets a vault when it has a Chainlink feed and a USDG pool trading at least $100,000 a day; the vault is sized to the pool, at most $100,000 and at most 20% of the pool's in-range liquidity, and at least $10,000; the replay gate then decides whether deposits open.
- Vault size caps (deposit_cap_usd; StockVault and StockVaultV4 enforce it on-chain through depositCap, and each replay runs at this size): ${bySymbol.map((v) => `${v.symbol} ${usd(v.depositCapUsd)}`).join(", ")}. A deposit above a vault's cap is refused by prepare_deposit.
- The liquidity range is centred on the Chainlink price, computed on-chain. Exits are priced to the oracle with minimum-output bounds. Deposits pause when the Chainlink feed is stale.
- USDG deposits go through the Uptick router: depositUsdg for a v3 vault, depositUsdgV4 for a v4 vault. prepare_deposit picks the entry point from the vault's venue.
- Across three pools, liquidity providers earned 13.64 dollars in fees per dollar lost to informed traders on weekends, against 1.16 in NYSE hours (weekends ahead in 22 of 23 pool-weeks).
- Fee APR figures are replay measurements of past swaps, not promised returns.

## Product

- [Vaults](/vaults): every Stock Token vault with fee APR, kept APR and gate state
- [NVDA vault](/vault/nvda): deposit panel, pool evidence, what liquidity providers keep

## For AI agents

- [Evidence API](${WORKER}/vaults): JSON list of vaults with venue, fee tier, state (open, reduced or closed), per_tx_cap_usd, kept_worst_half_pct, fee APR and kept APR; the open flag is true when the vault accepts deposits (state open or reduced); CORS open
- [Vault evidence](${WORKER}/vaults/nvda): per-pool replay evidence and the gate rule for one vault
- [MCP server](${WORKER}/mcp): Streamable HTTP MCP endpoint with tools list_vaults, get_vault_evidence, prepare_deposit, prepare_withdraw, get_collateral_terms and prepare_earn_and_borrow. prepare_* returns unsigned transactions for the user to sign; closed vaults are refused with their reason, and a vault still launching answers with its gate and venue. prepare_withdraw takes mode redeem or in_kind. get_collateral_terms returns the Morpho Blue market (params, market id, LLTV) for a vault share used as collateral against USDG; prepare_earn_and_borrow returns approve, deposit, approve shares, supplyCollateral and borrow as one ordered list, and returns a reason instead of calldata when the vault is not deployed or no market is configured.

`;
}
