# lighter-agent-kit paper run for the weekend hedge proposal

Claim under test: the `agent_instruction` that `plan_weekend_hedge` returns can be pasted into an agent that has lighter-agent-kit, runs verbatim in the kit's paper engine against the live Lighter Robinhood Chain order book with no key and no funds, and the fill lands where the proposal said it would (average fill within 1 bp of `expected_avg_fill_price`, liquidation within 0.1 USD of the estimate, never worse than `limit_price`).

Result: confirmed on the NVDA plan for wallet 0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245 (1274.1037 NVDA held, 1275.0913 shares to short). No live order was placed, no credential was read or created, no VPN was used.

## Kit and environment

| Item | Value |
|---|---|
| Repo | https://github.com/elliottech/lighter-agent-kit |
| Latest release tag | v0.1.0, commit 764ddc76132ac64b087c29565c82996676adde47, 2026-04-22 (GitHub release 2026-04-23, one asset: install.sh) |
| Commit actually run | 9798b37230d631b4a09a5a28d2436f5405a00992 = `v0.1.0-4-g9798b37`, main HEAD, 2026-08-19 (merge of PR #2 "Add Robinhood Lighter deployment support") |
| Why not the tag | v0.1.0 has no Robinhood Chain support: `grep -ri robinhood` over the tag finds nothing. The deployment (`api.rh.lighter.xyz`, `USDG`, `AAPL/USDG` spot pairs, `account mode`, `account collateral`) arrived in main after the tag. There is no later release. |
| What the one-line installer fetches | `install.sh` of the release is byte-identical to the tag's (sha256 34739fab...8a95) and runs `git clone --depth 1 --single-branch` of the repo, so it installs main HEAD, not the tag. A user following the README gets the Robinhood-capable kit; the version is whatever main is that day |
| Pin used here | /Users/kamal/.agents/tools/lighter-agent-kit-pinned, detached at 9798b37 |
| SDK | lighter-sdk 1.1.2 from https://github.com/elliottech/lighter-python at 6957dd8a1b36894ca9580be0d51de30aeea3bd4a (the sha in requirements.lock). The installed copy under .vendor was diffed against a clone of that sha: identical apart from __pycache__ |
| Python | 3.12.13 (`python3` on this machine is a pyenv shim that fails; a scratch bin dir put 3.12 first on PATH). HOME pointed at /Users/kamal/.agents/tools/lighter-agent-kit-home so the kit's state, symbol cache and credentials path never touched the real home |
| Geo gate | `GET https://api.rh.lighter.xyz/api/v1/orderBooks` returned HTTP 200, code 200 from this machine. Code 20558 was not seen on any read. The kit's own `query.py market list` and `paper.py` order-book reads worked against the same host |
| Symbol form | perp = the bare ticker `NVDA` (market_index 15); spot = `NVDA/USDG` (market_index 2054). The kit decides perp vs spot by the presence of `/` (scripts/_symbols.py `resolve_symbol`). `paper.py` refuses the spot form. This is what `execution_proposal.market.symbol` carries |

## What was read before anything ran

Every script in the pin was read: install.sh (979 lines, not run), lighter-config, scripts/_sdk.py, _symbols.py, _paths.py, _assets.py, _cli.py, bootstrap.py, health.py, paper.py, query.py (host and auth paths), trade.py (signer, order, leverage paths), and the SDK's paper_client (client.py, matching.py, risk.py, accounting.py, types.py), setup.py and the signer loader.

Nothing in the kit sends data anywhere except the configured `LIGHTER_HOST`, `pypi.org`, `files.pythonhosted.org` and `github.com` (the installer also downloads a gum release from github.com). No telemetry, no analytics, no key is ever written to a log or sent to a third party. Private keys are wrapped in a `SecretValue` whose `str` and `repr` print `[REDACTED]`; they are read from env or `~/.lighter/lighter-agent-kit/credentials` (0600, warned if looser) and passed only to the SDK signer. Paper mode never reads a credential.

Things worth knowing, none of them a leak:

1. The installer tracks main, not the release (above). A key-holding agent that runs it gets unreviewed future commits. Pin a commit.
2. `requirements.lock` pins versions but carries no hashes, and pip runs with `--no-deps` from PyPI; `lighter-sdk` is built from source with `setup.py` out of a GitHub sha. Trust is in PyPI and GitHub at install time.
3. The SDK ships prebuilt signer binaries (`lighter/signers/*.dylib|.so|.dll`; darwin-arm64 sha256 70f74303...09d76f9). `trade.py` loads one with `ctypes.CDLL` and hands it the API private key. It is closed and was not audited. `paper.py` never constructs a `SignerClient`, so it never loads it.
4. An unmerged branch (`origin/devin/1777918547-tag-user-agent`, commit 423589a) adds a `User-Agent: lighter-agent-kit/<version> lighter-python/<sdk>` header to every request so Lighter can attribute traffic. It is not in the pinned main. If merged, every call to Lighter identifies the kit version.
5. `install.sh` and `lighter-config` prompt the user for the API private key (written to the credentials file at 0600). That is the user's own interactive step; Uptick never sees it and nothing here ran it.
6. `scripts/health.py` prints version 0.1.0 and `bootstrap.py` prints `sdk_version 1.0.0` while the installed SDK is 1.1.2: the version strings are stale and cannot be used as a pin.

## Run log

Produced by `spikes/stock-hedge/agent-kit-paper-run.py` from the plan in `spikes/stock-hedge/agent-kit-paper-plan.json` (made by `bun spikes/stock-hedge/agent-kit-plan.ts 0x28C6...C245 nvda`, which calls `plan_weekend_hedge` through the Worker's MCP handler against live Lighter RH and the live chain, block 96,697,941). The paper commands in section A are extracted from the `agent_instruction` text by prefix and run unedited. It is reproduced whole below (the .log file itself is gitignored).

```
# kit
v0.1.0-4-g9798b37
9798b37230d631b4a09a5a28d2436f5405a00992
2026-08-19 10:17:33 -0400
{"url": "https://github.com/elliottech/lighter-python.git", "vcs_info": {"commit_id": "6957dd8a1b36894ca9580be0d51de30aeea3bd4a", "requested_revision": "6957dd8a1b36894ca9580be0d51de30aeea3bd4a", "vcs": "git"}}
Python 3.12.13

# the proposal under test (from plan_weekend_hedge, market_data_at 2026-10-24T10:32:03.290Z, valid_until 2026-10-24T10:42:03.290Z)
Place a proposed weekend hedge on Lighter's Robinhood Chain exchange with lighter-agent-kit, from my own Lighter account. Paper trade it first with scripts/paper.py, and place it live with scripts/trade.py only after the paper run looks right and I say so.

Host: LIGHTER_HOST=https://api.rh.lighter.xyz
Market: NVDA perp (market_id 15), symbol NVDA
Side: sell (short)
Size: 1275.0913 NVDA, about 269222.78 USD notional
Order: limit sell at 210.70 or higher (a protective limit below the deepest bid this size walks; expected average fill about 211.04). Cancel any part that does not fill.
Leverage: 5x cross (the market allows up to 20x), about 53844.56 USDG of margin
Valid until: 2026-10-24T10:42:03.290Z (the book was read at 2026-10-24T10:32:03.290Z). After that, ask Uptick for a new plan before placing.
Exit by: 2026-10-26T13:00:00.000Z. Check the position every few hours and close by 2026-10-26T13:00:00.000Z with a reduce-only buy of 1275.0913 NVDA.
Estimated: round trip slippage 8.51 bp, fees 0 bp, funding earns 3.89 bp, margin interest 0 bp, liquidation near 245.87.

Paper (run from the kit folder, no key needed; use reset in place of init if a paper account already exists):
python3 scripts/paper.py init --collateral 53844.56 --tier standard
python3 scripts/paper.py order ioc NVDA --side short --amount 1275.0913 --price 210.70
python3 scripts/paper.py positions --symbol NVDA
python3 scripts/paper.py order market NVDA --side long --amount 1275.0913

Live, only after I confirm:
python3 scripts/trade.py position leverage NVDA --leverage 5 --margin_mode cross
python3 scripts/trade.py order limit NVDA --side short --amount 1275.0913 --price 210.70
python3 scripts/trade.py order market NVDA --side long --amount 1275.0913 --reduce_only

This is a proposal from Uptick's planner, not an executed hedge. Uptick placed nothing and holds no keys or funds; the key, the order and the funds stay with me.

# reads: symbol form and the geo gate
GET /api/v1/orderBooks -> HTTP 200, code 200 (a geo block would be code 20558)

[2026-10-24T10:32:03.885Z] $ python3 scripts/query.py market list --search NVDA
{"code": 200, "markets": [{"symbol": "NVDA", "market_index": 15, "market_type": "perp"}, {"symbol": "NVDA/USDG", "market_index": 2054, "market_type": "spot"}], "filter_hint": "result spans multiple market_types; retry with --market_type perp|spot to narrow"}

# book snapshot at 2026-10-24T10:32:04.938Z (limit=100 a side, what paper.py sees): best bid 211.13, best ask 211.15, mid 211.14, bid depth 6144.03 NVDA over 100 levels
our walk of this book for 1275.0913 NVDA sold by base size: average 211.0374, unfilled 0.0

# A. the proposal's own paper commands, verbatim

[2026-10-24T10:32:04.939Z] $ python3 scripts/paper.py reset --collateral 1 --tier standard    # scratch HOME: clears any earlier run so init below starts clean
{"status": "ok", "collateral": 1.0, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:05.511Z] $ python3 scripts/paper.py init --collateral 53844.56 --tier standard
{"status": "ok", "collateral": 53844.56, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:06.059Z] $ python3 scripts/paper.py order ioc NVDA --side short --amount 1275.0913 --price 210.70
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "ioc", "limit_price": 210.7, "filled_size": 1275.0913000000003, "avg_price": 211.04729095634167, "total_fee": 0.0, "quote_amount": 269104.564587, "unfilled": 0.0, "liquidated": false, "fills_count": 33}

[2026-10-24T10:32:07.016Z] $ python3 scripts/paper.py positions --symbol NVDA
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 1275.0913000000003, "avg_entry_price": 211.04729095634167, "mark_price": 211.14, "unrealized_pnl": -118.21249500004342, "realized_pnl": 0.0, "liquidation_price": 245.8983442243346}]}

[2026-10-24T10:32:07.869Z] $ python3 scripts/paper.py liquidation_price NVDA
{"symbol": "NVDA", "market_id": 15, "liquidation_price": 245.8983442243346, "mark_price": 211.14, "position_side": "short", "position_size": 1275.0913000000003}

[2026-10-24T10:32:08.695Z] $ python3 scripts/paper.py health
{"status": "pre_liquidation", "total_account_value": 53726.347504999954, "initial_margin_requirement": 134611.38854100002, "maintenance_margin_requirement": 8076.683312460001, "margin_usage": 250.55, "leverage": 5.011, "collateral": 53844.56, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0}

[2026-10-24T10:32:09.529Z] $ python3 scripts/paper.py order market NVDA --side long --amount 1275.0913
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "long", "order_type": "market", "filled_size": 1275.0912999999998, "avg_price": 211.21302824668325, "total_fee": 0.0, "quote_amount": 269315.894764, "unfilled": 0.0, "liquidated": false, "fills_count": 46}

[2026-10-24T10:32:10.368Z] $ python3 scripts/paper.py trades --symbol NVDA --limit 3
{"trades": [{"symbol": "NVDA", "market_id": 15, "side": "buy", "size": 19.409899999999592, "price": 211.35, "fee": 0.0, "realized_pnl": -5.875552266504201, "is_liquidation": false, "timestamp": "2026-10-24T10:32:10.293581+00:00"}, {"symbol": "NVDA", "market_id": 15, "side": "buy", "size": 0.8121, "price": 211.34, "fee": 0.0, "realized_pnl": -0.23770901435494807, "is_liquidation": false, "timestamp": "2026-10-24T10:32:10.293577+00:00"}, {"symbol": "NVDA", "market_id": 15, "side": "buy", "size": 14.2, "price": 211.33, "fee": 0.0, "realized_pnl": -4.014468419948571, "is_liquidation": false, "timestamp": "2026-10-24T10:32:10.293572+00:00"}]}

[2026-10-24T10:32:10.915Z] $ python3 scripts/paper.py positions
{"positions": []}

[2026-10-24T10:32:11.474Z] $ python3 scripts/paper.py status
{"status": "ok", "collateral": 53633.22982299995, "initial_collateral": 53844.56, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "unrealized_pnl": 0, "total_pnl": -211.33017700004712, "positions_count": 0, "trades_count": 79, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

# A. numbers
proposal expected_avg_fill_price 211.04 (USD walk of 250 levels at 2026-10-24T10:32:03.290Z), limit_price 210.70
our base walk of the 100-level book just before: 211.0374
paper open avg_price 211.0473, filled 1275.0913000000003, unfilled 0.0, fee 0.0, fills 33
paper vs proposal expected: +0.35 bp; paper vs our base walk: +0.47 bp
paper open fill vs proposal limit: 211.0473 >= 210.70: True
paper close avg_price 211.2130, fee 0.0
paper round trip (buy back avg 211.2130 vs sell avg 211.0473) cost 7.85 bp of notional = 211.33 USD; proposal estimated_costs.slippage_bp 8.51 bp = 229.17 USD (slippage is measured against mid, so the spread is in both)

# A2. the same open on the kit's default tier (premium, 2.8 bp taker) against Lighter RH's 0 fee

[2026-10-24T10:32:12.029Z] $ python3 scripts/paper.py reset --collateral 53844.56 --tier premium
{"status": "ok", "collateral": 53844.56, "tier": "premium", "taker_fee_bps": 2.8, "maker_fee_bps": 0.4, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:12.577Z] $ python3 scripts/paper.py order ioc NVDA --side short --amount 1275.0913 --price 210.70
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "ioc", "limit_price": 210.7, "filled_size": 1275.0913, "avg_price": 211.0461786344241, "total_fee": 75.348880957, "quote_amount": 269103.14627500006, "unfilled": 0.0, "liquidated": false, "fills_count": 34}

[2026-10-24T10:32:13.728Z] $ python3 scripts/paper.py order market NVDA --side long --amount 1275.0913
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "long", "order_type": "market", "filled_size": 1275.0913000000005, "avg_price": 211.23815304519758, "total_fee": 75.41742072927998, "quote_amount": 269347.93117600004, "unfilled": 0.0, "liquidated": false, "fills_count": 45}
premium tier fee on the open: 75.35 USD (2.80 bp); the standard-tier run above charged 0.0; Lighter RH NVDA taker_fee in the proposal: fees_bp 0

# B. orders that should be rejected or refused

[2026-10-24T10:32:14.585Z] $ python3 scripts/paper.py reset --collateral 53844.56 --tier standard
{"status": "ok", "collateral": 53844.56, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:15.140Z] $ python3 scripts/paper.py order market NVDA --side short --amount 0.01    # below Lighter's minimum of 0.0400 NVDA (min_quote 10 USD): does paper refuse it?
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "market", "filled_size": 0.01, "avg_price": 211.13999999999996, "total_fee": 0.0, "quote_amount": 2.1113999999999997, "unfilled": 0.0, "liquidated": false, "fills_count": 1}

[2026-10-24T10:32:16.017Z] $ python3 scripts/paper.py positions --symbol NVDA
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 0.01, "avg_entry_price": 211.13999999999996, "mark_price": 211.14499999999998, "unrealized_pnl": -5.000000000032756e-05, "realized_pnl": 0.0, "liquidation_price": 5227832.17475728}]}

[2026-10-24T10:32:16.775Z] $ python3 scripts/paper.py order market NVDA --side long --amount 0.01    # close it
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "long", "order_type": "market", "filled_size": 0.01, "avg_price": 211.14999999999998, "total_fee": 0.0, "quote_amount": 2.1115, "unfilled": 0.0, "liquidated": false, "fills_count": 1}

[2026-10-24T10:32:17.580Z] $ python3 scripts/paper.py order market NVDA --side short --amount 1.23456    # five size decimals, NVDA takes four
{"error": "base amount 1.23456 exceeds 4 size decimals for NVDA"}

[2026-10-24T10:32:18.540Z] $ python3 scripts/paper.py order market NVDA --side short --amount 0    # zero
{"error": "--amount must be positive"}

[2026-10-24T10:32:19.096Z] $ python3 scripts/paper.py order ioc NVDA --side short --amount 1.0 --price 250.00    # sell IOC priced above every bid: not marketable
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "ioc", "limit_price": 250.0, "filled_size": 0.0, "avg_price": 0.0, "total_fee": 0.0, "quote_amount": 0.0, "unfilled": 1.0, "liquidated": false, "fills_count": 0}

[2026-10-24T10:32:20.082Z] $ python3 scripts/paper.py order ioc NVDA --side short --amount 1.0 --price 210.123    # three price decimals, NVDA takes two
{"error": "price 210.123 exceeds 2 price decimals for NVDA"}

[2026-10-24T10:32:20.901Z] $ python3 scripts/paper.py order market NVDA2 --side short --amount 1    # unknown symbol
{"error": "unknown symbol 'NVDA2'; use `query.py market list --search NVDA2` to discover available markets"}

[2026-10-24T10:32:21.855Z] $ python3 scripts/paper.py order market NVDA/USDG --side short --amount 1    # the spot pair form
{"error": "paper trading supports perp markets only; use a perp symbol like ETH, not ETH/USDC"}

[2026-10-24T10:32:22.412Z] $ python3 scripts/paper.py positions
{"positions": []}

# C. partial fills

[2026-10-24T10:32:22.973Z] $ python3 scripts/paper.py reset --collateral 5000000 --tier standard
{"status": "ok", "collateral": 5000000.0, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

# book at 2026-10-24T10:32:23.829Z: top 3 bid levels hold 27.5692 NVDA down to 211.12; sell 427.5692 IOC at 211.12 should fill about 27.5692 and leave about 400 unfilled

[2026-10-24T10:32:23.829Z] $ python3 scripts/paper.py order ioc NVDA --side short --amount 427.5692 --price 211.12    # partial fill by limit price
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "ioc", "limit_price": 211.12, "filled_size": 156.7482, "avg_price": 211.12165735874478, "total_fee": 0.0, "quote_amount": 33092.939772, "unfilled": 270.821, "liquidated": false, "fills_count": 5}
partial: filled 156.7482, unfilled 270.821, avg 211.1217, fills 5; partial=True

[2026-10-24T10:32:24.775Z] $ python3 scripts/paper.py positions --symbol NVDA
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 156.7482, "avg_entry_price": 211.12165735874478, "mark_price": 211.14499999999998, "unrealized_pnl": -3.658917000000656, "realized_pnl": 0.0, "liquidation_price": 31174.188920693447}]}

# depth exhaustion: paper reads 100 levels a side holding 6166.71 NVDA; sell 7400.0495 at market

[2026-10-24T10:32:25.673Z] $ python3 scripts/paper.py order market NVDA --side short --amount 7400.0495    # partial fill by depth
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "market", "filled_size": 6166.5275999999985, "avg_price": 210.3282652922854, "total_fee": 0.0, "quote_amount": 1296995.0529849997, "unfilled": 1233.5219000000031, "liquidated": false, "fills_count": 100}
depth partial: filled 6166.5275999999985, unfilled 1233.5219000000031, fills 100

[2026-10-24T10:32:26.679Z] $ python3 scripts/paper.py positions --symbol NVDA
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 6323.2757999999985, "avg_entry_price": 210.34793275298858, "mark_price": 211.14499999999998, "unrealized_pnl": -5040.076033999678, "realized_pnl": 0.0, "liquidation_price": 971.9197283506645}]}

[2026-10-24T10:32:27.596Z] $ python3 scripts/paper.py status
{"status": "ok", "collateral": 5000000.0, "initial_collateral": 5000000.0, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "unrealized_pnl": -5040.076033999678, "total_pnl": -5040.076033999678, "positions_count": 1, "trades_count": 105, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:28.361Z] $ python3 scripts/paper.py positions
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 6323.2757999999985, "avg_entry_price": 210.34793275298858, "mark_price": 211.14499999999998, "unrealized_pnl": -5040.076033999678, "realized_pnl": 0.0, "liquidation_price": 971.9197283506645}]}

[2026-10-24T10:32:29.309Z] $ python3 scripts/paper.py order market NVDA --side long --amount 6323.2758    # close what is open
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "long", "order_type": "market", "filled_size": 6015.531000000002, "avg_price": 211.99653931847408, "total_fee": 0.0, "quote_amount": 1275271.754163, "unfilled": 307.7448000000049, "liquidated": false, "fills_count": 100}

[2026-10-24T10:32:30.203Z] $ python3 scripts/paper.py positions
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 307.74480000000307, "avg_entry_price": 210.34793275298878, "mark_price": 211.14499999999998, "unrealized_pnl": -245.29330051801662, "realized_pnl": -9917.24390148103, "liquidation_price": 15946.942340404048}]}

[2026-10-24T10:32:31.041Z] $ python3 scripts/paper.py status
{"status": "ok", "collateral": 4990082.756098519, "initial_collateral": 5000000.0, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "unrealized_pnl": -245.29330051801662, "total_pnl": -10162.537201998937, "positions_count": 1, "trades_count": 205, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

# D. a position on thin collateral: the engine reports its liquidation price

[2026-10-24T10:32:31.968Z] $ python3 scripts/paper.py reset --collateral 1000 --tier standard
{"status": "ok", "collateral": 1000.0, "tier": "standard", "taker_fee_bps": 0.0, "maker_fee_bps": 0.0, "state_path": "/Users/kamal/.agents/tools/lighter-agent-kit-home/.lighter/lighter-agent-kit/paper-state.json"}

[2026-10-24T10:32:32.572Z] $ python3 scripts/paper.py order market NVDA --side short --amount 100    # about 21,000 USD notional on 1,000 USD collateral
{"status": "ok", "symbol": "NVDA", "market_id": 15, "side": "short", "order_type": "market", "filled_size": 100.0, "avg_price": 211.12259788, "total_fee": 0.0, "quote_amount": 21112.259788, "unfilled": 0.0, "liquidated": false, "fills_count": 5}

[2026-10-24T10:32:33.647Z] $ python3 scripts/paper.py positions
{"positions": [{"symbol": "NVDA", "market_id": 15, "side": "short", "size": 100.0, "avg_entry_price": 211.12259788, "mark_price": 211.14499999999998, "unrealized_pnl": -2.2402120000006107, "realized_pnl": 0.0, "liquidation_price": 214.68213386407766}]}

# paper state removed
```

## What matched the estimate

| Quantity | Proposal | Paper engine | Gap |
|---|---|---|---|
| Open average fill (1275.0913 NVDA, IOC at the protective limit) | expected_avg_fill_price 211.04 | 211.0473 over 33 fills | +0.35 bp (the proposal walks 250 levels by USD at read time, paper walks 100 levels by base a second or two later; our own base walk of the 100-level book fetched just before the order was 211.0374, paper was +0.47 bp off that) |
| Fill versus the protective limit | limit_price 210.70 | every fill at or above 210.70 | held; the limit sits 0.16% under the average fill, so it bounds a bad book without refusing a normal one |
| Fully filled | n/a | filled 1275.0913, unfilled 0.0 | the 100-level paper book holds about 6,100 NVDA, 4.8x this order |
| Liquidation price | estimated_liquidation_price 245.87 | `liquidation_price` 245.90 | 0.03 USD. The paper formula (cross, collateral = margin_usdg, 3% maintenance) is the same algebra as the proposal's, so this is agreement of two derivations of the same model, not an independent check of Lighter's engine |
| Fee | fees_bp 0, so the instruction sets `--tier standard` | 0.0 USD on the open and the close | matched only because the instruction sets the tier (below) |
| Round trip cost | slippage_bp 8.51 (229 USD) | sold at 211.0473, bought back at 211.2130 a few seconds later: 7.85 bp, 211.33 USD | within 0.7 bp; the book moved between the legs, so this is one sample, not a distribution |
| Close | reduce-only buy of the full size | `order market NVDA --side long --amount 1275.0913` flattened it (`positions` empty) | paper has no `--reduce_only`, so the instruction's paper close is a plain market buy; the live close line carries `--reduce_only` |
| Symbol | `NVDA` | resolved to market 15 perp | the kit rejects the spot form `NVDA/USDG` in paper |

## What did not match, and what the instruction now does about it

1. Fee tier. Paper builds each market's fees from its own tier table (`premium` 2.8 bp taker is the default), not from the exchange. Lighter RH lists NVDA at 0 taker and 0 maker. On the default tier the same open charged 75.35 USD (2.80 bp). Fix in the instruction: `paper.py init ... --tier standard` when the plan's fee is zero; when Lighter's fee string is not zero its unit is not known, so the instruction leaves the tier alone and `fees_bp` is null.
2. Leverage. Paper has no leverage command; margin is whatever collateral the account holds. The instruction sets `--collateral margin_usdg` (notional / leverage), which makes paper's liquidation price equal the proposal's. `paper.py health` still prints `pre_liquidation` for the 5x position because its initial margin requirement uses the market's `default_initial_margin_fraction` (5000 = 50%, i.e. 2x), not the chosen leverage. That status is a paper artifact; the live equivalent is `trade.py position leverage NVDA --leverage 5 --margin_mode cross`, which the paper run cannot rehearse.
3. Minimum order size is not modelled. A 0.01 NVDA short (2.11 USD, under Lighter's 0.0400 NVDA and 10 USD minimums) filled in paper. The planner's own refusal (a below-minimum holding yields the reason and no proposal) is therefore the only guard in this path; paper cannot demonstrate the exchange rejecting it, and no live order was sent to see the exchange's message.
4. Rejections paper does model: five size decimals ("base amount 1.23456 exceeds 4 size decimals for NVDA"), zero amount, three price decimals, an unknown symbol, a spot pair. A sell IOC priced above every bid is not an error: status ok, filled 0.0, unfilled 1.0.
5. Partial fills are modelled in two ways only. By limit price: an IOC for 427.5692 NVDA at 211.12 filled 156.7482 and left 270.821 unfilled (the book moved a few levels between the snapshot and the order; the run asserts `partial=True`). By depth: a market sell of 7,400 NVDA against the 100-level snapshot filled 6,166.5 and left 1,233.5, and closing 6,323.2758 later filled 6,015.5 and left a 307.7 NVDA short open. No latency, no resting order, no maker fill, no queue. The proposal's "cancel any part that does not fill" has nothing to act on in paper.
6. Funding is not accrued in paper, so the 3.89 bp the proposal expects a short to earn cannot be rehearsed. That is the dominant weekend term in the plan and stays unverified until a live run.
7. The proposal reads 250 book levels a side; paper reads 100. At this size (4.8x inside paper's depth) the two agree; a size near 6,000 NVDA would price differently.

## Reproduce

```
bun spikes/stock-hedge/agent-kit-plan.ts 0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245 nvda > spikes/stock-hedge/agent-kit-paper-plan.json
python3.12 spikes/stock-hedge/agent-kit-paper-run.py spikes/stock-hedge/agent-kit-paper-plan.json \
  <kit checkout at 9798b37> <scratch HOME> <dir whose python3 is 3.12> > /tmp/agent-kit-paper-run.log
```

Blind spots: one wallet, one symbol, one weekend, one pair of snapshots seconds apart; the book was read on a Saturday morning UTC when US equities are closed, which is the case the hedge targets but not a Friday-close or Monday-open book. Paper cannot show leverage, funding, minimum-size rejection, maker behaviour or the live signer path.
