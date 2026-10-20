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
      lede="A public evidence API and an MCP server that prepares unsigned deposit and withdraw transactions for Uptick vaults."
    >
      <TLDR>
        <ul>
          <li>GET /vaults and GET /vaults/:id serve the gate, the replay and the caps as JSON. CORS is open.</li>
          <li>POST /mcp is a Streamable HTTP JSON-RPC 2.0 endpoint with four tools.</li>
          <li>prepare_deposit and prepare_withdraw return unsigned transactions. The user signs and sends.</li>
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
            "id, ticker, open, deposit_cap_usd, fee_apr_pct, kept_apr_pct, pool and window_days for every vault.",
          ],
          [
            "GET /vaults/:id",
            "The full detail: token, pool, fee tier, feed, the per-pool replay, and the gate with its rule, reason, worst half and swap count.",
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
  "id": "mstr",
  "ticker": "MSTR",
  "open": false,
  "deposit_cap_usd": 22206,
  "fee_apr_pct": 229.1253738312145,
  "kept_apr_pct": -28.53260158684701,
  "pool": "0x17578C0e0D15da44f31677263114F71aE76653EA",
  "window_days": 30
}`}
      />

      <H2>The MCP server</H2>
      <P>
        <Code>POST /mcp</Code> speaks JSON-RPC 2.0 over Streamable HTTP. <Code>initialize</Code> returns
        protocolVersion 2025-06-18, the tools capability, serverInfo, and instructions for how to report a
        vault. <Code>tools/list</Code> returns the four tools. <Code>tools/call</Code> runs one. A
        notification, a message with no id, returns 204. A malformed body returns -32700 and an unknown
        method returns -32601.
      </P>
      <DataTable
        columns={["Tool", "What it does"]}
        rows={[
          [
            "list_vaults",
            "Every vault with its gate state, open flag, deposit cap, fee APR, kept APR and the gate reason.",
          ],
          [
            "get_vault_evidence",
            "Full evidence for one vault: the replay pools, the gate rule and reason, the replay window, the swap count, and a source URL.",
          ],
          [
            "prepare_deposit",
            "Unsigned transactions for a deposit. Refuses closed vaults with the gate reason, and refuses an amount above the vault's deposit cap or, for a reduced vault, its per-transaction cap, whichever is lower. Asset stock approves the Stock Token then calls ERC-4626 deposit; asset usdg approves USDG then zaps through the Uptick router.",
          ],
          [
            "prepare_withdraw",
            "The unsigned ERC-4626 redeem for a vault. Shares are 24 decimals, 18 plus the vault offset of 6.",
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
      "id": "mstr",
      "ticker": "MSTR",
      "gate_state": "closed",
      "open": false,
      "deposit_cap_usd": 22206,
      "fee_apr_pct": 229.1253738312145,
      "kept_apr_pct": -28.53260158684701,
      "reason": "Closed: the weaker half kept -28.5% a year, below the -20% floor."
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
          The JSON-RPC dispatch, the four tools, the cap checks and the refusals.
        </SourceRef>
        <SourceRef path="web/public/llms.txt">
          The canonical gate states, caps and endpoint list.
        </SourceRef>
      </Sources>
    </Article>
  );
}
