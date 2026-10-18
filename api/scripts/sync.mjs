import { copyFile, mkdir } from "node:fs/promises";
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
    from: resolve(repoRoot, "keeper/data/replay.json"),
    to: resolve(dataDir, "replay.json"),
  },
];

await mkdir(dataDir, { recursive: true });

for (const { from, to } of sources) {
  await copyFile(from, to);
  console.log(`synced ${from} -> ${to}`);
}
