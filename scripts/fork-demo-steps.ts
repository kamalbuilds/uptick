// Prints the calls the web app's "earn and borrow" flow sends (web/lib/morpho.ts earnAndBorrowSteps) for one plan, as JSON
// [{id, to, data}], so scripts/e2e-fork.sh sends the same encoding a wallet receives from the app.
// MODE=id prints the market id instead (web/lib/morpho.ts marketId, the id the app derives).
// Usage: PLAN='{"symbol":"AAPL","token":"0x..","vault":"0x..","account":"0x..","market":{"loanToken":"0x..","collateralToken":"0x..",
//   "oracle":"0x..","irm":"0x..","lltv":"915000000000000000"},"deposit":"..","collateral":"..","borrow":"..","tokenAllowance":"0","shareAllowance":"0"}' bun scripts/fork-demo-steps.ts
import { earnAndBorrowSteps, marketId } from "../web/lib/morpho.ts";

const raw = process.env.PLAN;
if (!raw) throw new Error("set PLAN to the flow plan JSON");
const p = JSON.parse(raw);
if (process.env.MODE === "id") {
  console.log(marketId({ ...p.market, lltv: BigInt(p.market.lltv) }));
  process.exit(0);
}
const steps = earnAndBorrowSteps({
  symbol: p.symbol,
  token: p.token,
  vault: p.vault,
  account: p.account,
  market: { ...p.market, lltv: BigInt(p.market.lltv) },
  deposit: BigInt(p.deposit),
  collateral: BigInt(p.collateral),
  borrow: BigInt(p.borrow),
  tokenAllowance: BigInt(p.tokenAllowance),
  shareAllowance: BigInt(p.shareAllowance),
});
console.log(JSON.stringify(steps.map((s) => ({ id: s.id, to: s.call.to, data: s.call.data }))));
