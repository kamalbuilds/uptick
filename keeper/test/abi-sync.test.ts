import { expect, test } from "bun:test";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { vaultAbi, vaultV4Abi } from "../src/abi";
import { factoryAbi } from "../src/registry";
import compiled from "../../contracts/out/StockVault.sol/StockVault.json";
import compiledV4 from "../../contracts/out/StockVaultV4.sol/StockVaultV4.json";
import compiledFactory from "../../contracts/out/VaultFactory.sol/VaultFactory.json";

const sig = (x: AbiEvent | AbiFunction) => `${x.name}(${x.inputs.map((i) => i.type).join(",")})`;

test("every vault event and function the keeper reads exists in the compiled StockVault ABI", () => {
  const contract = compiled.abi as readonly (AbiEvent | AbiFunction)[];
  const events = new Set(contract.filter((x) => x.type === "event").map((x) => toEventSelector(sig(x))));
  const fns = new Set(contract.filter((x) => x.type === "function").map((x) => toFunctionSelector(sig(x))));
  const used = vaultAbi.filter((x) => x.type === "event" || x.type === "function") as readonly (AbiEvent | AbiFunction)[];
  expect(used.length).toBeGreaterThan(0);
  const missing = used.filter((x) => !(x.type === "event" ? events : fns).has(x.type === "event" ? toEventSelector(sig(x)) : toFunctionSelector(sig(x)))).map(sig);
  expect(missing).toEqual([]);
});

test("every custom error the keeper decodes exists in the compiled StockVault ABI", () => {
  const contract = compiled.abi as readonly { type: string; name?: string; inputs?: { type: string }[] }[];
  const errors = new Set(contract.filter((x) => x.type === "error").map((x) => toFunctionSelector(`${x.name}(${x.inputs!.map((i) => i.type).join(",")})`)));
  const used = vaultAbi.filter((x) => x.type === "error");
  expect(used.length).toBeGreaterThan(0);
  const missing = used.filter((x) => !errors.has(toFunctionSelector(`${x.name}(${x.inputs.map((i) => i.type).join(",")})`))).map((x) => x.name);
  expect(missing).toEqual([]);
});

type Frag = { type: string; name?: string; stateMutability?: string; inputs?: readonly { type: string; name?: string; indexed?: boolean }[]; outputs?: readonly { type: string }[] };

/** Every function, event and error of `abi` must exist in the compiled `artifact` with the same selector; functions also with the same outputs and mutability, events with the same input names and indexed flags (the keeper reads `args.<name>`). */
function drift(abi: readonly Frag[], artifact: readonly Frag[]): string[] {
  const key = (x: Frag) => `${x.type} ${x.name}(${(x.inputs ?? []).map((i) => i.type).join(",")})`;
  const byKey = new Map(artifact.map((x) => [key(x), x]));
  const out: string[] = [];
  for (const x of abi) {
    const c = byKey.get(key(x));
    if (!c) { out.push(`missing ${key(x)}`); continue; }
    if (x.type === "function") {
      if ((x.outputs ?? []).map((o) => o.type).join() !== (c.outputs ?? []).map((o) => o.type).join()) out.push(`${key(x)} outputs differ`);
      const view = (m?: string) => m === "view" || m === "pure";
      if (view(x.stateMutability) !== view(c.stateMutability)) out.push(`${key(x)} mutability ${x.stateMutability} vs ${c.stateMutability}`);
    }
    if (x.type === "event") {
      const sig = (f: Frag) => (f.inputs ?? []).map((i) => `${i.name}:${!!i.indexed}`).join();
      if (sig(x) !== sig(c)) out.push(`${key(x)} input names or indexed flags differ`);
    }
  }
  return out;
}

test("every fragment of vaultV4Abi (functions with outputs and mutability, events, errors) matches the compiled StockVaultV4 ABI", () => {
  expect(vaultV4Abi.length).toBeGreaterThan(10);
  expect(vaultV4Abi.some((x) => x.type === "function" && x.name === "poke")).toBe(true);
  expect(vaultV4Abi.filter((x) => x.type === "error").length).toBe(6);
  expect(drift(vaultV4Abi as unknown as readonly Frag[], compiledV4.abi as unknown as readonly Frag[])).toEqual([]);
});

test("every fragment of factoryAbi (v3 and v4 registry) matches the compiled VaultFactory ABI", () => {
  expect(factoryAbi.some((x) => x.type === "event" && x.name === "VaultCreatedV4")).toBe(true);
  expect(factoryAbi.some((x) => x.type === "function" && x.name === "vaultOfV4")).toBe(true);
  expect(drift(factoryAbi as unknown as readonly Frag[], compiledFactory.abi as unknown as readonly Frag[])).toEqual([]);
});

test("the drift check can fail: a wrong output, a wrong mutability and a missing function are all reported", () => {
  const art = compiledV4.abi as unknown as readonly Frag[];
  const poke = vaultV4Abi.find((x) => x.type === "function" && x.name === "poke") as Frag;
  expect(drift([{ ...poke, outputs: [{ type: "uint256" }] }], art)).toEqual(["function poke() outputs differ"]);
  expect(drift([{ ...poke, stateMutability: "view" }], art)).toEqual(["function poke() mutability view vs nonpayable"]);
  expect(drift([{ ...poke, name: "poke2" }], art)).toEqual(["missing function poke2()"]);
});
