#!/usr/bin/env bash
# One command: forks Robinhood Chain 4663 from the public RPC, runs the whole Uptick product on it (factory, router, PLTR v4 and AAPL v3 vaults,
# share oracle, Morpho Blue market, lender, borrower, 3% pool push, stale feed, feed drop, liquidation) and writes every transaction to docs/FORK-DEMO.md.
# Exits non-zero at the first step that fails. FORK_BLOCK=<n> pins the fork block; DEMO_ORACLE=spot swaps in the spot-reading oracle (step 17 must go red).
exec env E2E_ONLY=demo "$(cd "$(dirname "$0")" && pwd)/e2e-fork.sh" "$@"
