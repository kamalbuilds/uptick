import type { Metadata } from "next";
import {
  Article,
  Callout,
  Code,
  CodeBlock,
  DataTable,
  H2,
  H3,
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
          <li>POST /mcp is a Streamable HTTP JSON-RPC 2.0 endpoint with ten tools.</li>
          <li>scan_wallet reads any wallet address and returns its Stock Token holdings in USD with each vault's gate. It is read-only.</li>
          <li>plan_weekend_hedge sizes a weekend short on Lighter's Robinhood Chain exchange from what a wallet holds and prices it from live Lighter reads. It is read-only, returns no calldata, and hands the short to the holder's own agent as an execution_proposal.</li>
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
            "The full detail: token, venue, pool, fee tier, feed, the per-pool replay, and the gate with its rule, reason, weaker half and swap count.",
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
  "fee_apr_pct": 271.7667068310479,
  "kept_apr_pct": -93.53472943489602,
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
        vault. <Code>tools/list</Code> returns the ten tools. <Code>tools/call</Code> runs one. A
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
            "Unsigned transactions as two batches: approve and deposit, then approve shares, supplyCollateral and borrow. The vault holds fresh shares until the chain's next block, so batch two goes out about 12 seconds after batch one confirms, and the response says how to check. The borrow is checked against the loan-to-value limit and the market's liquidity before any calldata returns; otherwise the tool returns the vault's gate or the market's reason in place of calldata.",
          ],
          [
            "check_loan_health",
            "A wallet's Morpho Blue loan against a vault share, read live from the chain: collateral and its value, the debt with interest accrued to the latest block, health factor, the share price at which it liquidates and how far the share can fall first. A vault with no market, or a wallet with no position, answers with the reason.",
          ],
          [
            "prepare_make_safer",
            "The unsigned calls that take that loan to a target health factor, default 1.6, with the least action: approve and repay when the wallet holds the USDG, otherwise rounds of withdrawCollateral, redeemInKind and repay with the USDG leg while the stock leg returns to the wallet. With no market, no position, a loan already at the target or a target out of reach, transactions is empty and reason says why.",
          ],
          [
            "plan_weekend_hedge",
            "Read-only. Takes a wallet address and a source, wallet or loan (a loan also takes the vault id), and sizes a short of the matching Stock Token perp on Lighter's Robinhood Chain exchange from the Stock Tokens the wallet holds, or from the stock leg of its vault shares, using the on-chain ERC-8056 multiplier. Reads Lighter live for funding, order-book slippage at that size and margin terms, and returns the notional, slippage in basis points, whether the short earns or pays funding over the weekend in basis points, the margin cost, whether Lighter accepts the token as margin, the leverage (default 5, up to the market's maximum, 1 / min initial margin; above it the tool returns an error), the close and default unwind times and a hand-off link. It also returns execution_proposal, the same short as an order for the holder's own agent (market symbol, sell, base size and notional, a protective limit price from the book walk, suggested and maximum leverage, estimated costs, market_data_at, valid_until, exit_by, liquidation estimate and risk notes), and agent_instruction, the text to paste into an agent that has lighter-agent-kit. It returns no calldata. A Lighter failure returns an error carrying the upstream code, never a zero-cost plan; a wallet with no holding answers with the reason.",
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
      "fee_apr_pct": 271.7667068310479,
      "kept_apr_pct": -93.53472943489602,
      "reason": "Closed: the weaker half kept -93.5% a year, below the -20% floor."
    }
  ]
}`}
      />
      <H2>Hedge with your own agent</H2>
      <P>
        Uptick plans the weekend short and your agent places it. The planner never signs, never holds a key
        or funds, and does not hedge the vault itself. Your agent runs Lighter&apos;s official{" "}
        <Code>lighter-agent-kit</Code> with your own Lighter account and your own key.
      </P>
      <DataTable
        columns={["Step", "Who", "What happens"]}
        rows={[
          [
            "1. Plan",
            "Uptick MCP",
            "plan_weekend_hedge reads the wallet, the on-chain ERC-8056 multiplier and the live Lighter book, funding and margin terms, then returns the plan with execution_proposal and agent_instruction.",
          ],
          [
            "2. Place",
            "lighter-agent-kit, with your key",
            "Your agent takes agent_instruction, rehearses it with scripts/paper.py against the live order book, and places it with scripts/trade.py when you say so. It checks the position every few hours and closes by exit_by.",
          ],
        ]}
        caption="Lighter's Robinhood Chain deployment is selected with LIGHTER_HOST=https://api.rh.lighter.xyz. Use lighter-agent-kit at commit 9798b37 or later."
      />
      <H3>Step 1: ask Uptick for the plan</H3>
      <CodeBlock
        label="JSON-RPC request"
        code={`{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "plan_weekend_hedge",
    "arguments": { "address": "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245", "vault": "nvda" }
  }
}`}
      />
      <P>
        The payload keeps the plan&apos;s own figures and adds the order. Abbreviated, for 1,275.0913 NVDA read
        at one block:
      </P>
      <CodeBlock
        label="execution_proposal, abbreviated"
        code={`{
  "status": "proposed",
  "venue": "lighter-robinhood-chain",
  "market": { "symbol": "NVDA", "market_id": 15, "type": "perp" },
  "side": "sell",
  "size": { "base": "1275.0913", "notional_usd": 269222.78 },
  "order": { "type": "limit", "limit_price": "210.70", "expected_avg_fill_price": "211.04" },
  "leverage": { "suggested": 5, "max": 20, "margin_mode": "cross" },
  "estimated_costs": { "slippage_bp": 8.51, "fees_bp": 0, "funding_bp": 3.89, "funding_direction": "earns" },
  "estimated_liquidation_price": 245.87,
  "market_data_at": "2026-10-24T10:32:03.290Z",
  "valid_until": "2026-10-24T10:42:03.290Z",
  "exit_by": "2026-10-26T13:00:00.000Z"
}`}
      />
      <H3>Step 2: your agent places it</H3>
      <P>
        Paste <Code>agent_instruction</Code> into an agent that has the kit. It names the market, side, size,
        leverage, limit price and exit time, and it opens with paper trading. The Robinhood Chain
        perpetual is the bare ticker, <Code>NVDA</Code>.
      </P>
      <CodeBlock
        label="Paper, from the kit folder (no key)"
        code={`export LIGHTER_HOST=https://api.rh.lighter.xyz
python3 scripts/paper.py init --collateral 53844.56 --tier standard
python3 scripts/paper.py order ioc NVDA --side short --amount 1275.0913 --price 210.70
python3 scripts/paper.py positions --symbol NVDA`}
      />
      <P>
        In a paper run against the live Lighter order book on 2026-10-24, that proposal filled in full at an
        average within 1 basis point of expected_avg_fill_price, with every fill at or above the limit. A size under Lighter&apos;s smallest order returns the
        reason and no proposal, so there is nothing to paste.
      </P>

      <Callout tone="key" label="The server never signs">
        The prepare tools only build unsigned transactions for the user to sign. Never sign, send, or
        broadcast anything yourself. When you report a vault, cite the gate reason verbatim and state the
        replay window. Fee APR and kept APR are a replay of past swap flow, not a forecast.
      </Callout>

      <Sources>
        <SourceRef path="api/src/worker.ts">
          The /vaults, /vaults/:id, /llms.txt and /health routes.
        </SourceRef>
        <SourceRef path="web/lib/hedge.ts">
          proposeExecution and agentInstruction: the order and the text derived from the plan.
        </SourceRef>
        <SourceRef path="api/src/mcp.ts">
          The JSON-RPC dispatch, the ten tools, the cap checks and the refusals.
        </SourceRef>
        <SourceRef path="web/public/llms.txt">
          The canonical gate states, caps and endpoint list.
        </SourceRef>
      </Sources>
    </Article>
  );
}
