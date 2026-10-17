import type { Hash, PublicClient, TransactionReceipt } from "viem";

/** Receipt wait that survives RPC hiccups on a custom chain: retries with backoff before giving up. */
export async function waitForReceipt(client: PublicClient, hash: Hash, attempts = 6): Promise<TransactionReceipt> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 2_000 });
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** i));
    }
  }
  throw new Error(`No receipt for ${hash} after ${attempts} tries: ${last instanceof Error ? last.message : String(last)}`);
}

export function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}
