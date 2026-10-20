import { expect, test } from "bun:test";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { vaultAbi } from "../src/abi";
import compiled from "../../contracts/out/StockVault.sol/StockVault.json";

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
