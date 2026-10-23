import { describe, expect, test } from "bun:test";
import { toFunctionSelector, type AbiFunction } from "viem";
import { ERC20_ABI, ERC4626_ABI, ROUTER_ABI } from "../src/mcp";
import { erc20Abi as webErc20, routerAbi as webRouter, vaultAbi as webVault } from "../../web/lib/abis";
import router from "../../contracts/out/UptickRouter.sol/UptickRouter.json";
import stockVault from "../../contracts/out/StockVault.sol/StockVault.json";
import stockVaultV4 from "../../contracts/out/StockVaultV4.sol/StockVaultV4.json";

type Frag = { type: string; name?: string; stateMutability?: string; inputs?: readonly { type: string }[]; outputs?: readonly { type: string }[] };
const fns = (abi: readonly Frag[]) => abi.filter((x) => x.type === "function") as unknown as readonly AbiFunction[];
const shape = (f: AbiFunction) => `${f.name}(${f.inputs.map((i) => i.type).join(",")}) ${f.stateMutability} -> (${f.outputs.map((o) => o.type).join(",")})`;
const shapes = (abi: readonly Frag[]) => new Set(fns(abi).map(shape));

/** Every function the Worker encodes must exist, with the same selector, mutability and outputs, in the compiled contract and in the ABI the web app signs with. */
function missingFrom(used: readonly Frag[], contract: readonly Frag[]): string[] {
  const have = shapes(contract);
  return fns(used).filter((f) => !have.has(shape(f))).map(shape);
}

describe("the calldata the Worker encodes matches the compiled contracts and the web app", () => {
  test("UptickRouter: depositUsdg and depositUsdgV4", () => {
    expect(fns(ROUTER_ABI).map((f) => f.name)).toEqual(["depositUsdg", "depositUsdgV4"]);
    expect(missingFrom(ROUTER_ABI, router.abi as Frag[])).toEqual([]);
    expect(missingFrom(ROUTER_ABI, webRouter as unknown as Frag[])).toEqual([]);
  });

  test("StockVault and StockVaultV4 both carry the ERC-4626 deposit, redeem and redeemInKind the Worker builds", () => {
    expect(fns(ERC4626_ABI).map((f) => f.name)).toEqual(["deposit", "redeem", "redeemInKind"]);
    expect(missingFrom(ERC4626_ABI, stockVault.abi as Frag[])).toEqual([]);
    expect(missingFrom(ERC4626_ABI, stockVaultV4.abi as Frag[])).toEqual([]);
    expect(missingFrom(ERC4626_ABI, webVault as unknown as Frag[])).toEqual([]);
  });

  test("USDG approve is the web app's approve", () => {
    expect(missingFrom(ERC20_ABI, webErc20 as unknown as Frag[])).toEqual([]);
    expect(toFunctionSelector("approve(address,uint256)")).toBe("0x095ea7b3");
  });

  test("the check can fail: a router ABI with a changed depositUsdgV4 signature is reported missing", () => {
    const drifted = [{ type: "function", name: "depositUsdgV4", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] }];
    expect(missingFrom(drifted, router.abi as Frag[]).length).toBe(1);
  });
});
