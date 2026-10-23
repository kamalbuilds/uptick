import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "..");
const dataDir = resolve(apiRoot, "data");

const sources = [
  {
    from: resolve(repoRoot, "web/lib/vault-universe.json"),
    to: resolve(dataDir, "vault-universe.json"),
  },
  {
    from: resolve(repoRoot, "web/lib/collateral-markets.json"),
    to: resolve(dataDir, "collateral-markets.json"),
  },
  {
    from: resolve(repoRoot, "keeper/data/replay.json"),
    to: resolve(dataDir, "replay.json"),
  },
  // The wallet scan and the math under it are written once in web/lib; test/shared-sync.test.ts fails when these copies drift.
  ...["scan.ts", "price-math.ts", "morpho.ts", "loan.ts", "abis.ts"].map((f) => ({
    from: resolve(repoRoot, "web/lib", f),
    to: resolve(apiRoot, "src/shared", f),
  })),
];

await mkdir(dataDir, { recursive: true });
await mkdir(resolve(apiRoot, "src/shared"), { recursive: true });

for (const { from, to } of sources) {
  await copyFile(from, to);
  console.log(`synced ${from} -> ${to}`);
}

// llms.txt for the API domain: the web app's file minus the site-relative "Product" section.
const llms = await readFile(resolve(repoRoot, "web/public/llms.txt"), "utf8");
const apiLlms = llms.replace(/\n## Product\n[\s\S]*?(?=\n## )/, "\n");
await writeFile(resolve(apiRoot, "src/llms.ts"), `export default ${JSON.stringify(apiLlms)};\n`);
console.log("synced llms.txt -> src/llms.ts");
