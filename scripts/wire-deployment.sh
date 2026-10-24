#!/usr/bin/env bash
# Wires a finished deploy into the repo from deployments/4663.json (written by scripts/deploy-mainnet.sh --broadcast):
#   web/package.json   build:pages gets NEXT_PUBLIC_VAULTS and NEXT_PUBLIC_ROUTER   (+ web/.env.local for `npm run dev`)
#   api/wrangler.toml  the Worker's VAULTS and ROUTER vars
#   README.md          the "Deployed on Robinhood Chain" address table
#   docs/SUBMISSION.md the deployed addresses block
#   keeper/.env.local  VAULT_ADDRESS_<SYM> and VAULT_DEPLOY_BLOCK_<SYM>
# It deploys neither the web app nor the Worker: the two commands are printed at the end. Rerunnable.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
D=${DEPLOYMENTS_FILE:-$APP/deployments/4663.json}
X=https://robinhoodchain.blockscout.com
die() { echo "REFUSED: $*" >&2; exit 1; }
[ -f "$D" ] || die "$D does not exist; run scripts/deploy-mainnet.sh --broadcast first"
jq -e '.chainId == 4663 and (.vaults | length) > 0 and (.vaults | to_entries | all(.value.address | test("^0x[0-9a-fA-F]{40}$"))) and (.router.address | test("^0x[0-9a-fA-F]{40}$"))' "$D" >/dev/null \
  || die "$D is not a complete 4663 deployment record"
VAULTS=$(jq -c '.vaults | map_values(.address)' "$D")
ROUTER=$(jq -r '.router.address' "$D")

# web: build:pages sets both variables to empty on its own command line, which beats any env file, so the values go there
node - "$APP/web/package.json" "$VAULTS" "$ROUTER" <<'JS'
const fs = require("fs");
const [file, vaults, router] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
let s = pkg.scripts["build:pages"];
const before = s;
s = s.replace(/NEXT_PUBLIC_VAULTS=(?:'[^']*'|\S*)/, () => `NEXT_PUBLIC_VAULTS='${vaults}'`).replace(/NEXT_PUBLIC_ROUTER=\S*/, () => `NEXT_PUBLIC_ROUTER=${router}`);
if (!s.includes(`NEXT_PUBLIC_VAULTS='${vaults}'`) || !s.includes(`NEXT_PUBLIC_ROUTER=${router}`)) throw new Error("build:pages has no NEXT_PUBLIC_VAULTS / NEXT_PUBLIC_ROUTER assignment to replace");
pkg.scripts["build:pages"] = s;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log(before === s ? "web/package.json build:pages already wired" : "web/package.json build:pages wired");
JS
setenv() { { grep -v "^$2=" "$1" 2>/dev/null || true; echo "$2=$3"; } > "$1.tmp" && mv "$1.tmp" "$1"; }
touch "$APP/web/.env.local" "$APP/keeper/.env.local"
setenv "$APP/web/.env.local" NEXT_PUBLIC_VAULTS "'$VAULTS'"
setenv "$APP/web/.env.local" NEXT_PUBLIC_ROUTER "$ROUTER"
while IFS=$'\t' read -r SYM A B; do
  setenv "$APP/keeper/.env.local" "VAULT_ADDRESS_$SYM" "$A"; setenv "$APP/keeper/.env.local" "VAULT_DEPLOY_BLOCK_$SYM" "$B"
done < <(jq -r '.vaults | to_entries[] | [.key, .value.address, .value.block] | @tsv' "$D")

# api: the Worker's plain vars
node - "$APP/api/wrangler.toml" "$VAULTS" "$ROUTER" <<'JS'
const fs = require("fs");
const [file, vaults, router] = process.argv.slice(2);
let t = fs.readFileSync(file, "utf8");
t = t.replace(/^ROUTER = .*\n/m, "");
if (!/^VAULTS = .*$/m.test(t)) throw new Error("api/wrangler.toml has no VAULTS var");
t = t.replace(/^VAULTS = .*$/m, () => `VAULTS = '${vaults}'\nROUTER = "${router}"`);
fs.writeFileSync(file, t);
console.log("api/wrangler.toml VAULTS and ROUTER set");
JS

# README and SUBMISSION: a marked block, replaced in place on a rerun
TABLE=$(jq -r --arg x "$X" '
  def link(a): "[`\(a)`](\($x)/address/\(a))";
  "| Contract | Address | Deposit cap |\n|---|---|---|"
  + "\n| VaultFactory | \(link(.factory.address)) | |"
  + "\n| UptickRouter | \(link(.router.address)) | |"
  + (if .oracleFactory then "\n| UptickShareOracleFactory | \(link(.oracleFactory.address)) | |" else "" end)
  + ([.vaults | to_entries[] | "\n| \(.key) vault (\(if .value.venue == "v4" then "Uniswap v4" else "Uniswap v3" end) pool) | \(link(.value.address)) | $\(.value.capUsd) |"
      + (if .value.oracle then "\n| \(.key) share oracle | \(link(.value.oracle)) | |" else "" end)] | join(""))' "$D")
BLOCK=$(jq -r '[.factory.block, (.vaults[].block)] | max' "$D")
node - "$APP/README.md" "$APP/docs/SUBMISSION.md" "$TABLE" "$BLOCK" <<'JS'
const fs = require("fs");
const [readme, submission, table, block] = process.argv.slice(2);
const put = (file, anchor, heading, lead) => {
  const body = `<!-- deployed:start -->\n${heading}\n\n${lead}\n\n${table}\n<!-- deployed:end -->\n`;
  let t = fs.readFileSync(file, "utf8");
  if (t.includes("<!-- deployed:start -->")) t = t.replace(/<!-- deployed:start -->[\s\S]*?<!-- deployed:end -->\n/, () => body);
  else { if (!t.includes(anchor)) throw new Error(`${file} has no "${anchor}" to insert before`); t = t.replace(anchor, () => `${body}\n${anchor}`); }
  fs.writeFileSync(file, t);
  console.log(`${file} address block written`);
};
const lead = `Live on Robinhood Chain mainnet (chain id 4663) through block ${block}. Every address returns bytecode from \`cast code\`; the factory pins the creation-code hash of StockVault and StockVaultV4, each vault's deposit cap, owner, keeper, pool and feed were read back from the chain after the deploy, and every share oracle is registered in the oracle factory's \`isOracle\`.`;
put(readme, "## Run locally", "## Deployed on Robinhood Chain", lead);
put(submission, "## 6. Safety", "### Deployed addresses", lead);
JS

cat <<EOF

wired. Not deployed by this script, run these two yourself:
  web   cd $APP/web && npm run build:pages && npx wrangler pages deploy out --project-name uptick-fi
  api   cd $APP/api && npx wrangler deploy
EOF
