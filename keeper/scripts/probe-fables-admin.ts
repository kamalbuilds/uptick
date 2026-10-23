/** Builds data/fables-admin.json: who can call the restricted functions of the Fables hooks in data/fables-pools.json. Reads the shared OpenZeppelin AccessManager the hooks name as
 *  `authority`: the role each restricted selector needs on each hook (getTargetFunctionRole), whether the target is closed, the target admin delay, and every role's members from the
 *  RoleGranted / RoleRevoked logs since the manager's deploy block, each confirmed with hasRole (membership and execution delay) and typed as EOA, Safe (owners and threshold) or other contract.
 *  Read-only, public RPC only, logs paged and bisected on error. Run: bun scripts/probe-fables-admin.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, parseAbi, parseAbiItem, toFunctionSelector, type AbiFunction, type Address, type Hex } from "viem";
import { client, retry } from "../src/chain.ts";
import { log } from "../src/log.ts";

const DATA = new URL("../data/", import.meta.url);
const AM_DEPLOY_BLOCK = 37250998n; // Sourcify deployment record of the AccessManager
const PAGE = 2_000_000n;

const amAbi = parseAbi([
  "function getTargetFunctionRole(address target, bytes4 selector) view returns (uint64)",
  "function isTargetClosed(address target) view returns (bool)",
  "function getTargetAdminDelay(address target) view returns (uint32)",
  "function hasRole(uint64 roleId, address account) view returns (bool isMember, uint32 executionDelay)",
  "function getRoleAdmin(uint64 roleId) view returns (uint64)",
  "function getRoleGuardian(uint64 roleId) view returns (uint64)",
  "function getRoleGrantDelay(uint64 roleId) view returns (uint32)",
  "function minSetback() view returns (uint32)",
]);
const safeAbi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const granted = parseAbiItem("event RoleGranted(uint64 indexed roleId, address indexed account, uint32 delay, uint48 since, bool newMember)");
const revoked = parseAbiItem("event RoleRevoked(uint64 indexed roleId, address indexed account)");

/** Functions the verified sources mark `restricted` (FablesBaseHook, FablesLedger, FablesRWA, FablesRamp, MarketCalendar). Their signatures come from each hook's Sourcify ABI. */
const RESTRICTED = new Set(["pokeFee", "clearPoke", "setPoolConfig", "setClaimFee", "setFFFeeSink", "setDistributor", "setPaused", "pause", "setPoolPaused", "pausePool", "setClaimFeeBps", "setPoolAsymmetry", "setBallotGate", "setDayOverrides", "setSessionHours", "setDstMode"]);

async function restrictedSelectors(hook: Address): Promise<{ sig: string; selector: Hex }[]> {
  const res = await fetch(`https://sourcify.dev/server/v2/contract/4663/${getAddress(hook)}?fields=abi`);
  if (!res.ok) throw new Error(`sourcify abi ${hook}: ${res.status}`);
  const abi = ((await res.json()) as { abi: AbiFunction[] }).abi.filter((x) => x.type === "function" && RESTRICTED.has(x.name));
  return abi.map((f) => { const selector = toFunctionSelector(f); return { sig: `${f.name} ${selector}`, selector }; });
}

async function logsBisect(event: typeof granted | typeof revoked, address: Address, from: bigint, to: bigint): Promise<any[]> {
  try { return await retry(() => client.getLogs({ address, event, fromBlock: from, toBlock: to })) as any[]; }
  catch (e) {
    if (to - from < 1000n) throw e;
    const mid = (from + to) / 2n;
    return [...(await logsBisect(event, address, from, mid)), ...(await logsBisect(event, address, mid + 1n, to))];
  }
}

async function main() {
  const pools = JSON.parse(readFileSync(new URL("fables-pools.json", DATA), "utf8"));
  const am = Object.values(pools.hooks as Record<string, { authority: Address }>).map((h) => h.authority);
  if (new Set(am.map((a) => a.toLowerCase())).size !== 1) throw new Error(`hooks name different authorities: ${am.join(",")}`);
  const AM = am[0];
  const block = await retry(() => client.getBlockNumber());
  const targets: Record<string, unknown> = {};
  for (const hook of Object.keys(pools.hooks) as Address[]) {
    const roles: Record<string, number> = {};
    const sels = await restrictedSelectors(hook);
    for (const { sig, selector } of sels) roles[sig] = Number(await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "getTargetFunctionRole", args: [hook, selector], blockNumber: block })));
    targets[hook] = {
      name: pools.hooks[hook].name,
      closed: await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "isTargetClosed", args: [hook], blockNumber: block })),
      adminDelayS: await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "getTargetAdminDelay", args: [hook], blockNumber: block })),
      functionRoles: roles,
    };
  }
  const seen = new Map<string, { roleId: number; account: Address }>();
  for (let a = AM_DEPLOY_BLOCK; a <= block; a += PAGE) {
    const b = a + PAGE - 1n > block ? block : a + PAGE - 1n;
    for (const ev of [granted, revoked]) for (const l of await logsBisect(ev, AM, a, b)) seen.set(`${l.args.roleId}|${l.args.account}`, { roleId: Number(l.args.roleId), account: l.args.account });
  }
  const members: Record<string, unknown>[] = [];
  for (const { roleId, account } of [...seen.values()].sort((x, y) => x.roleId - y.roleId)) {
    const [isMember, executionDelay] = await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "hasRole", args: [BigInt(roleId), account], blockNumber: block }));
    if (!isMember) continue;
    const code = await client.getCode({ address: account, blockNumber: block });
    const delegate = code?.startsWith("0xef0100") ? getAddress(`0x${code.slice(8)}`) : undefined; // EIP-7702 delegation designator: an EOA key whose code is another contract
    let kind = delegate ? "EOA with EIP-7702 delegation" : code && code !== "0x" ? "contract" : "EOA", owners: Address[] | undefined, threshold: number | undefined;
    if (kind === "contract") {
      try {
        owners = [...(await client.readContract({ address: account, abi: safeAbi, functionName: "getOwners", blockNumber: block }))];
        threshold = Number(await client.readContract({ address: account, abi: safeAbi, functionName: "getThreshold", blockNumber: block })); kind = "Safe";
      } catch { /* not a Safe */ }
    }
    members.push({ roleId, account, executionDelayS: executionDelay, kind, delegate, owners, threshold });
  }
  const roleIds = [...new Set([0, ...Object.values(targets).flatMap((t: any) => Object.values(t.functionRoles) as number[]), ...members.map((m: any) => m.roleId as number)])].sort((a, b) => a - b);
  const roleMeta: Record<string, unknown> = {};
  for (const id of roleIds) roleMeta[id] = {
    admin: Number(await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "getRoleAdmin", args: [BigInt(id)], blockNumber: block }))),
    guardian: Number(await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "getRoleGuardian", args: [BigInt(id)], blockNumber: block }))),
    grantDelayS: await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "getRoleGrantDelay", args: [BigInt(id)], blockNumber: block })),
  };
  const minSetbackS = await retry(() => client.readContract({ address: AM, abi: amAbi, functionName: "minSetback", blockNumber: block }));
  writeFileSync(new URL("fables-admin.json", DATA), JSON.stringify({ block: Number(block), accessManager: AM, accessManagerDeployBlock: Number(AM_DEPLOY_BLOCK), minSetbackS, targets, roleMeta, members }, null, 1) + "\n");
  log("done", { block: Number(block), hooks: Object.keys(targets).length, roles: roleIds, members: members.length });
}

main().catch((e) => { log("fatal", { error: String(e.message ?? e).slice(0, 400) }); process.exit(1); });
