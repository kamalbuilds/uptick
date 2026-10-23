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
  title: "For agents | Uptick",
  description:
    "The evidence API and the MCP server that prepares unsigned deposit and withdraw transactions.",
};

export default function ForAgentsPage() {
  return (
    <Article
      eyebrow="Build on Uptick"
      title="For agents"
      lede="A public evidence API and an MCP server that reads a wallet's Stock Tokens and prepares unsigned deposit and withdraw transactions for Uptick vaults."
    >
      <TLDR>
        <ul>
          <li>GET /vaults serves every vault with its cap and open flag. GET /vaults/:id adds the gate state, the reason and the per-pool replay. CORS is open.</li>
          <li>POST /mcp is a Streamable HTTP JSON-RPC 2.0 endpoint with nine tools.</li>
          <li>scan_wallet reads any wallet address and returns its Stock Token holdings in USD with each vault's gate. It is read-only.</li>
          <li>prepare_deposit, prepare_withdraw, prepare_earn_and_borrow and prepare_make_safer return unsigned transactions. The user signs and sends.</li>
        </ul>
      </TLDR>

      <H2>The evidence API</H2>
      <P>
        The base URL is{" "}
        <Code>https://uptick-evidence.earn-shield-alerts.workers.dev</Code>. Every response is JSON with CORS
        open, so a browser or a worker can read it directly.
      </P>
      <DataTable
        columns={["Endpoint", "What it returns"]}
        rows={[
          [
            "GET /vaults",
            "id, ticker, open, deposit_cap_usd, entry_fee_bps, fee_apr_pct, kept_apr_pct, venue (v3 or v4), fee_tier, pool and window_days for every vault, plus pool_id and pool_manager for a Uniswap v4 vault.",
          ],
          [
            "GET /vaults/:id",
            "The full detail: token, venue, pool, fee tier, feed, the per-pool replay, and the gate with its rule, reason, worst half and swap count.",
          ],
          [
            "GET /llms.txt",
            "The same facts as plain text for agents that read markdown.",
          ],
          [
            "GET /health",
            "ok, the generation time, the replay window and the total swaps replayed.",
          ],
        ]}
        caption="An unknown id returns 404 with an error, the id and a message."
      />
      <P>
        The response is a JSON array with one entry per vault, 17 today. The first entry, as served now:
      </P>
      <CodeBlock
        label="bash"
        code={`curl https://uptick-evidence.earn-shield-alerts.workers.dev/vaults`}
      />
      <CodeBlock
        label="Response, first entry"
        code={`{
  "id": "gme",
  "ticker": "GME",
  "open": false,
  "deposit_cap_usd": 49212,
  "entry_fee_bps": 100,
  "fee_apr_pct": 305.74351636968254,
  "kept_apr_pct": -144.19014548776155,
  "venue": "v3",
  "fee_tier_pips": 10000,
  "fee_tier": "1%",
  "pool": "0xE9713f453aDB9245B19559790c96F470a18F2fDF",
  "window_days": 30
}`}
      />

      <H2>The MCP server</H2>
      <P>
        <Code>POST /mcp</Code> speaks JSON-RPC 2.0 over Streamable HTTP. <Code>initialize</Code> returns
        protocolVersion 2025-06-18, the tools capability, serverInfo, and instructions for how to report a
        vault. <Code>tools/list</Code> returns the nine tools. <Code>tools/call</Code> runs one. A
        notification, a message with no id, returns 204. A malformed body returns -32700 and an unknown
        method returns -32601.
      </P>
      <DataTable
        columns={["Tool", "What it does"]}
        rows={[
          [
            "list_vaults",
            "Every vault with its gate state, open flag, venue, fee tier, deposit cap, fee APR, kept APR and the gate reason.",
          ],
          [
            "get_vault_evidence",
            "Full evidence for one vault: the replay pools, the gate rule and reason, the replay window, the swap count, and a source URL.",
          ],
          [
            "scan_wallet",
            "Read-only. Takes a wallet address, reads its balance of every tracked Stock Token from Robinhood Chain in one Multicall3 call at one block, prices each with the vault's Chainlink feed, and returns the holdings in USD with the vault's gate state and reason, what the holding would have kept a year at the weaker-half APR of the replay (a measurement of past swaps), and borrow room at the Morpho market's loan-to-value limit where a market is configured. Totals give idle value, what the open and reduced vaults take, and what the closed vaults refuse. The same read powers the /check page.",
          ],
          [
            "prepare_deposit",
            "Unsigned transactions for a deposit. Refuses closed vaults with the gate reason, and refuses an amount above the vault's deposit cap or, for a reduced vault, its per-transaction cap, whichever is lower. Asset stock approves the Stock Token then calls ERC-4626 deposit; asset usdg approves USDG then zaps through the Uptick router, depositUsdg for a Uniswap v3 vault and depositUsdgV4 for a Uniswap v4 vault. A vault whose address is still launching answers with its gate and venue and builds no transaction.",
          ],
          [
            "prepare_withdraw",
            "The unsigned exit for a vault on either venue: ERC-4626 redeem, or redeemInKind with mode in_kind. Shares are 24 decimals, 18 plus the vault offset of 6.",
          ],
          [
            "get_collateral_terms",
            "The Morpho Blue market for a vault share used as collateral against USDG: market params, market id and loan-to-value limit.",
          ],
          [
            "prepare_earn_and_borrow",
            "Unsigned transactions in order: approve, deposit, approve shares, supplyCollateral, borrow. The borrow is checked against the loan-to-value limit and the market's liquidity before any calldata returns; otherwise the tool returns the vault's gate or the market's reason in place of calldata.",
          ],
          [
            "check_loan_health",
            "A wallet's Morpho Blue loan against a vault share, read live from the chain: collateral and its value, the debt with interest accrued to the latest block, health factor, the share price at which it liquidates and how far the share can fall first. A vault with no market, or a wallet with no position, answers with the reason.",
          ],
          [
            "prepare_make_safer",
            "The unsigned calls that take that loan to a target health factor, default 1.6, with the least action: approve and repay when the wallet holds the USDG, otherwise rounds of withdrawCollateral, redeemInKind and repay with the USDG leg while the stock leg returns to the wallet. With no market, no position, a loan already at the target or a target out of reach, transactions is empty and reason says why.",
          ],
        ]}
        caption="The vault contract also enforces its deposit cap on-chain against its total, so the cap check in prepare_deposit is an early refusal, not the only one."
      />
      <P>A tools/call body for the same list:</P>
      <CodeBlock
        label="JSON-RPC request"
        code={`{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "list_vaults",
    "arguments": {}
  }
}`}
      />
      <P>
        The result arrives as a text payload, a JSON string. Pretty-printed, the first vault of the same
        call:
      </P>
      <CodeBlock
        label="Response payload, pretty-printed"
        code={`{
  "vaults": [
    {
      "id": "gme",
      "ticker": "GME",
      "gate_state": "closed",
      "open": false,
      "venue": "v3",
      "fee_tier_pips": 10000,
      "fee_tier": "1%",
      "pool": "0xE9713f453aDB9245B19559790c96F470a18F2fDF",
      "deposit_cap_usd": 49212,
      "entry_fee_bps": 100,
      "fee_apr_pct": 305.74351636968254,
      "kept_apr_pct": -144.19014548776155,
      "reason": "Closed: the weaker half kept -144.2% a year, below the -20% floor."
    }
  ]
}`}
      />
      <Callout tone="key" label="The server never signs">
        The prepare tools only build unsigned transactions for the user to sign. Never sign, send, or
        broadcast anything yourself. When you report a vault, cite the gate reason verbatim and state the
        replay window. Fee APR and kept APR are a replay of past swap flow, not a forecast.
      </Callout>

      <Sources>
        <SourceRef path="api/src/worker.ts">
          The /vaults, /vaults/:id, /llms.txt and /health routes.
        </SourceRef>
        <SourceRef path="api/src/mcp.ts">
          The JSON-RPC dispatch, the nine tools, the cap checks and the refusals.
        </SourceRef>
        <SourceRef path="web/public/llms.txt">
          The canonical gate states, caps and endpoint list.
        </SourceRef>
      </Sources>
    </Article>
  );
}
