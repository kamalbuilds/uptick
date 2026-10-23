import { type Address } from "viem";
import raw from "./collateral-markets.json";
import { marketFor, parseMarkets, type MarketParams } from "./morpho";
import { USDG } from "./vaults";

/** Morpho Blue market per vault id (web/lib/collateral-markets.json): USDG borrowed against the vault share, priced by the UptickShareOracle deployed for that vault.
 *  Entries arrive with the oracle. A vault with none shows the earn-only flow. */
const entries = parseMarkets(raw);

/** The market a vault's share is collateral in, or undefined while it has no configured market or no deployed vault. */
export function collateralMarket(id: string, vault: Address | undefined): MarketParams | undefined {
  const e = entries[id];
  return e && vault ? marketFor(e, USDG, vault) : undefined;
}
