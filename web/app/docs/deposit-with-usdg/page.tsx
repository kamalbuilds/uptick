import type { Metadata } from "next";
import {
  Article,
  Callout,
  Code,
  CodeBlock,
  DataTable,
  H2,
  P,
  SourceRef,
  Sources,
  TLDR,
} from "@/components/prose";

export const metadata: Metadata = {
  title: "Deposit USDG or a Stock Token | Uptick",
  description:
    "The two ways in, what instantDeploy changes, and when a deposit waits for the next rebalance.",
};

export default function DepositWithUsdgPage() {
  return (
    <Article
      eyebrow="Using a vault"
      title="Deposit USDG or a Stock Token"
      lede="USDG enters through UptickRouter.depositUsdg, which swaps to the Stock Token at the Chainlink-implied value less a slippage bound, then deposits."
    >
      <TLDR>
        <ul>
          <li>The router pulls USDG, swaps it to the Stock Token, and deposits the result in one transaction.</li>
          <li>The swap floor is the Chainlink value of the USDG less slippageBps, so a deposit reverts when the pool sits far below the oracle.</li>
          <li>The web app sets minShares from a live quote with a 1% cushion, so a worse fill reverts.</li>
        </ul>
      </TLDR>

      <H2>What depositUsdg does</H2>
      <P>
        <Code>UptickRouter.depositUsdg(vault, usdgIn, minShares, receiver)</Code> is the USDG on-ramp for a
        StockVault. It is nonReentrant and returns the shares minted. The router holds no balances and leaves
        no allowances behind after any call.
      </P>
      <DataTable
        columns={["Step", "Rule"]}
        rows={[
          [
            "Gate",
            "Reads vault.health() first and reverts Unhealthy unless the status is Ok.",
          ],
          [
            "Quote",
            "impliedStock = usdgIn * 10^(stockDecimals + feedDecimals) / (price * 10^usdgDecimals), matching StockVault._usdgToStock exactly.",
          ],
          [
            "Swap floor",
            "minStock = impliedStock * (10,000 - slippageBps) / 10,000.",
          ],
          [
            "Swap",
            "Pulls usdgIn with safeTransferFrom, approves the swap router, and calls exactInputSingle on the vault's own pool fee, then resets the allowance to zero.",
          ],
          [
            "Deposit",
            "Checks stockReceived against minStock (MinStockOut), approves the vault, calls vault.deposit(stockReceived, receiver), and resets the allowance.",
          ],
          [
            "Shares",
            "Reverts InsufficientShares when the vault mints fewer shares than minShares.",
          ],
        ]}
        caption="The router refuses the swap when the oracle gate is not Ok, before any token moves."
      />

      <H2>What the web app does</H2>
      <P>
        The deposit panel quotes before it asks you to sign. It divides your USDG amount by the live Chainlink
        price and keeps a 1% cushion for the swap, then asks the vault what those shares are worth with{" "}
        <Code>previewDeposit</Code>. That preview is the minShares you send, so a worse fill reverts instead of
        silently giving you fewer shares.
      </P>
      <P>
        When your USDG allowance to the router is below the amount, the panel sends one approval transaction
        first. That signature moves nothing. The deposit follows as a second transaction:{" "}
        <Code>depositUsdg(vault, amount, minShares, receiver)</Code>.
      </P>
      <P>
        The panel also checks the vault's remaining room under its size cap and disables the button when the
        deposit would exceed it, when your balance is too small, or when the quote is not ready. A reduced
        vault caps a single deposit at $25,000, converted at the live Chainlink price.
      </P>

      <H2>Error cases</H2>
      <DataTable
        columns={["Error", "What it means"]}
        rows={[
          [
            "Unhealthy",
            "The price feed is not fresh. Deposits pause until it updates.",
          ],
          [
            "InsufficientShares",
            "The price moved past your quote. Try again.",
          ],
          [
            "MinStockOut",
            "The pool sat far below the oracle at swap time. The router refuses rather than depositing at a bad price.",
          ],
          [
            "ZeroAmount",
            "The deposit was zero.",
          ],
        ]}
        caption="The panel names the two errors a depositor can act on and shows the router's message for the rest."
      />
      <Callout label="Allowances last one transaction">
        The router approves the swap router for exactly the deposit amount and the vault for exactly the
        stock received, then resets both to zero. No allowance survives the call.
      </Callout>

      <H2>Read the quote</H2>
      <P>
        The same quote the panel uses is one contract read away: <Code>previewDeposit</Code> on the vault,
        with the stock amount you expect the swap to return.
      </P>
      <CodeBlock
        label="TypeScript, viem"
        code={`const minShares = await client.readContract({
  address: vault,
  abi: vaultAbi,
  functionName: "previewDeposit",
  args: [estimatedStock],
});`}
      />

      <Sources>
        <SourceRef path="contracts/src/UptickRouter.sol">
          depositUsdg, _usdgToStock, the slippage floor and the custom errors.
        </SourceRef>
        <SourceRef path="web/components/deposit-panel.tsx">
          The quote, the 1% cushion, minShares from previewDeposit and the error mapping.
        </SourceRef>
      </Sources>
    </Article>
  );
}
