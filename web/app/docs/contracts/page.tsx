import type { Metadata } from "next";
import {
  Article,
  Code,
  DataTable,
  H2,
  P,
  SourceRef,
  Sources,
  TLDR,
} from "@/components/prose";

export const metadata: Metadata = {
  title: "Contracts | Uptick",
  description:
    "StockVault, the capped-hook standard, the deployed addresses and the test surface.",
};

export default function ContractsPage() {
  return (
    <Article
      eyebrow="Build on Uptick"
      title="Contracts"
      lede="Three contracts run a vault: StockVault holds the position, UptickRouter is the USDG on-ramp, and VaultFactory deploys and registers every vault."
    >
      <TLDR>
        <ul>
          <li>StockVault is an ERC-4626 vault per Stock Token with one managed Uniswap v3 position.</li>
          <li>UptickRouter swaps USDG into the Stock Token and deposits, or exits in kind with minimums.</li>
          <li>VaultFactory deploys each vault with CREATE2 and keeps the registry.</li>
        </ul>
      </TLDR>

      <H2>StockVault</H2>
      <P>
        An ERC-4626 vault over one Stock Token. Deposits are managed as a single Uniswap v3 position on the
        Stock Token / USDG pool, recentred once a day at +-rangeBps around the Chainlink price. Shares are a
        pro-rata claim on idle balances plus both legs of the position. Valuation uses Chainlink for price and
        the pool TWAP for the position's composition, and every value-in or value-out path reverts when feed,
        TWAP and spot disagree.
      </P>
      <DataTable
        columns={["Function", "What it does"]}
        rows={[
          ["deposit(assets, receiver)", "Takes an asset amount in the Stock Token and mints shares. Requires a healthy oracle."],
          ["mint(shares, receiver)", "Takes a share amount. Same gate as deposit."],
          ["withdraw(assets, receiver, owner)", "Sends exactly assets of the Stock Token and burns the shares the exit cost."],
          ["redeem(shares, receiver, owner)", "Burns shares and sends the actual proceeds in the Stock Token, at least previewRedeem."],
          ["redeemInKind(shares, receiver, owner)", "Pays the pro-rata share of both tokens. No oracle, no swap, not pausable."],
          ["claimStockOwed(to)", "Pays the caller's credited Stock Token from a failed redeemInKind transfer."],
          ["rebalance()", "Collects fees, closes the position and reopens it around Chainlink. The keeper waits minRebalanceInterval; anyone may call it once 26 hours have passed."],
          ["pause() / unpause()", "Stop deposits and mints. Withdrawals, redeemInKind and rebalance stay open."],
          ["health()", "The oracle gate as the guarded paths see it. Never reverts for a bad feed."],
          ["maxDeposit(owner)", "The remaining room under the deposit cap. Zero when paused."],
          ["previewRedeem(shares)", "A floor on what redeem delivers: fair value less the exit buffer."],
          ["setParams, setKeeper, setTreasury, setInstantDeploy, setDepositCap", "Owner admin for the parameters, keeper, treasury, instant deploy and the cap."],
        ]}
        caption="External functions. Views include totalAssets, totalValueInUSDG, pricePerShare, feesEarnedLifetime, positionInfo and currentRange."
      />

      <H2>UptickRouter</H2>
      <P>
        The USDG on-ramp for a StockVault. It swaps USDG into the Stock Token through the same Uniswap v3
        router and pool fee the vault uses, then deposits to the receiver. The swap floor is the
        Chainlink-implied stock amount from health().price less slippageBps, so a deposit reverts when the
        pool sits far below the oracle. The router holds no balances and leaves no allowances behind after
        any call.
      </P>
      <DataTable
        columns={["Function", "What it does"]}
        rows={[
          [
            "depositUsdg(vault, usdgIn, minShares, receiver)",
            "Pulls USDG, swaps it to the Stock Token at the oracle value less slippage, deposits, and checks minShares.",
          ],
          [
            "redeemInKindMin(vault, shares, minStock, minUsdg, receiver)",
            "Exits in kind, checks both legs against the caller's minimums, and forwards them to the receiver.",
          ],
        ]}
        caption="Both functions are nonReentrant."
      />

      <H2>VaultFactory</H2>
      <P>
        Deploys one StockVault per (Stock Token, pool, Chainlink feed) and keeps the registry the app and the
        keeper read. The factory pins the keccak256 of StockVault's creation code, so the only contract it can
        ever register is the audited build. The owner passes the creation code with each call; the factory
        checks it against the pinned hash, appends the constructor arguments and deploys with CREATE2 at the
        salt keccak256(stock, pool, feed).
      </P>
      <DataTable
        columns={["Function", "What it does"]}
        rows={[
          ["createVault(creationCode, stock, pool, feed, depositCap)", "Verifies the code hash, deploys with CREATE2 and registers the vault."],
          ["setDefaults(d)", "Applies new defaults to vaults created from now on. Existing vaults are untouched."],
          ["vaultOf(stock, pool)", "The vault deployed for a pair. Zero when none exists."],
          ["isVault(vault)", "True for every vault the factory deployed."],
          ["entries(offset, limit)", "A registry page of limit entries, fewer at the end."],
          ["vaultsOfStock(stock)", "Every vault on one Stock Token, one per pool."],
        ]}
        caption="vaultCount and entryAt round out the registry views."
      />

      <H2>Chain components in use</H2>
      <P>
        Each address returns bytecode from <Code>cast code</Code> against{" "}
        <Code>https://rpc.mainnet.chain.robinhood.com</Code>.
      </P>
      <DataTable
        columns={["Component", "Address"]}
        rows={[
          ["Uniswap v4 PoolManager", <Code key="a">0x8366a39CC670B4001A1121B8F6A443A643e40951</Code>],
          ["Uniswap v3 NonfungiblePositionManager", <Code key="b">0x73991a25c818bf1f1128deaab1492d45638de0d3</Code>],
          ["NVDA / USDG 0.05% pool", <Code key="c">0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3</Code>],
          ["NVDA", <Code key="d">0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC</Code>],
          ["SPCX", <Code key="e">0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa</Code>],
          ["USDG", <Code key="f">0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168</Code>],
        ]}
        caption="Robinhood Chain 4663. The components table from the repository README."
      />

      <Sources>
        <SourceRef path="contracts/src/StockVault.sol">
          The ERC-4626 vault, the position, the oracle gate and the exit paths.
        </SourceRef>
        <SourceRef path="contracts/src/UptickRouter.sol">
          The USDG on-ramp and the in-kind exit with minimums.
        </SourceRef>
        <SourceRef path="contracts/src/VaultFactory.sol">
          CREATE2 deployment and the vault registry.
        </SourceRef>
        <SourceRef path="README.md">
          The chain components table and the deployed addresses.
        </SourceRef>
      </Sources>
    </Article>
  );
}
