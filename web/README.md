# Uptick

Stock Token yield vaults on Robinhood Chain (chain 4663). Deposit NVDA or SPCX, and the vault places it in the Stock Token / USDG Uniswap v3 pool inside a price band and keeps the swap fees for the share holders.

## Routes

| Route | What it shows |
|---|---|
| `/` | The NVDA vault with its fee APR, window and source, the live price-against-band picture, three steps, the vault list |
| `/vault/[id]` | `nvda` and `spcx`. Fee APR, range chart (pool price against the vault's band), fees earned, on-chain addresses with explorer links, deposit and withdraw panel with a plain-language summary before signing |
| `/portfolio` | Vault shares the connected wallet holds, valued in the stock token and in USD |

## Data

- Stats come from the keeper API (`GET /vaults`, `/vaults/:id`, `/pools/:id/replay`) through the `/keeper/*` rewrite in `next.config.ts` (target `KEEPER_URL`, default the local keeper on port 8790). `feeApr` is read as a fraction (0.40 renders 40.0%).
- `pnpm build:pages` exports the static site to `out/` for Cloudflare Pages. The browser reads the same `/vaults` and `/vaults/:id` payloads from the `uptick-evidence` Worker (`/keeper/*`), set through `NEXT_PUBLIC_KEEPER_BASE`; the Worker serves the replay figures and reads TVL, share price and lifetime fees from a vault only when its address and a chain RPC are configured there.
- Each figure carries its source. A `replay` figure is labelled with its window; an `onchain` figure is read from the vault.
- Balances, allowances, previews and transactions go straight to the vault and token contracts over the chain RPC with wagmi and viem. ABIs are `parseAbi` constants.
- A vault whose address env var is unset shows as Opening and its deposit button is disabled.

## Wallets

EIP-6963 discovery with a curated picker: Rabby, MetaMask, Coinbase Wallet and Brave Wallet are offered, in that order; other injected providers are not listed. Installed wallets connect, the rest link to their installer. Every write shows signing, pending (with a Blockscout link) and confirmed or failed states. Receipt waits retry with backoff.

## Run

```
pnpm install
cp .env.example .env.local   # set NEXT_PUBLIC_VAULT_NVDA / NEXT_PUBLIC_VAULT_SPCX once deployed
pnpm dev                     # http://localhost:3000
pnpm typecheck && pnpm test && pnpm build
```

## Design

`DESIGN.md` is the wise system from the design-md library. Archivo 900 (width 86%) for display, Figtree for text, Geist Mono for figures. Tokens sit in `app/globals.css` under `@theme`.
