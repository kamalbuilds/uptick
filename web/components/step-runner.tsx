"use client";

import { useEffect, useState } from "react";
import { type Hash } from "viem";
import { useAccount, useCapabilities, usePublicClient, useSendCalls, useSendTransaction, useWaitForCallsStatus } from "wagmi";
import { ArrowSquareOut, CheckCircle, Circle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { robinhoodChain, txUrl } from "@/lib/chain";
import { isBatchUnsupported, supportsAtomicBatch, type Step } from "@/lib/morpho";
import { knownRevert } from "@/lib/revert";
import { errMessage, waitForReceipt } from "@/lib/tx";

export type StepState = "waiting" | "signing" | "pending" | "confirmed" | "failed";
export type Run = { mode: "batch" | "sequential"; steps: Step[]; states: StepState[]; hashes: (Hash | undefined)[]; batchId?: string; error?: string };

const txError = (err: unknown): string => knownRevert(err)?.copy ?? errMessage(err);

/** Runs a call list as one EIP-5792 batch when the wallet batches atomically, and one transaction per step when it cannot. A user rejection or a revert stops the run: only
 *  "this wallet cannot batch here" falls back. `batchOk` is what the wallet reported for Robinhood Chain. */
export function useStepRunner() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [run, setRun] = useState<Run | null>(null);
  const onChain = Boolean(address && chainId === robinhoodChain.id);
  const caps = useCapabilities({ account: address, query: { enabled: onChain } });
  const batchOk = supportsAtomicBatch(caps.data, robinhoodChain.id);
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();
  const batch = useWaitForCallsStatus({ id: run?.batchId ?? "", timeout: 180_000, pollingInterval: 2_000, query: { enabled: Boolean(run?.batchId) } });

  // A batch is one id on the wallet side: it confirms or fails every step together.
  useEffect(() => {
    if (!run?.batchId || run.mode !== "batch") return;
    const status = batch.data?.status;
    if (status === "success") {
      const hash = batch.data?.receipts?.at(-1)?.transactionHash;
      setRun((r) => (r && r.batchId === run.batchId ? { ...r, states: r.states.map(() => "confirmed"), hashes: r.hashes.map(() => hash) } : r));
    } else if (status === "failure" || batch.isError) {
      const error = batch.isError ? `The wallet did not report the batch as confirmed within three minutes. Check it before trying again. ${errMessage(batch.error)}` : "The batch reverted on-chain. Nothing in it took effect.";
      setRun((r) => (r && r.batchId === run.batchId ? { ...r, states: r.states.map(() => "failed"), error } : r));
    }
  }, [batch.data?.status, batch.isError, batch.error, batch.data?.receipts, run?.batchId, run?.mode]);

  function patch(i: number, state: StepState, hash?: Hash, error?: string) {
    setRun((r) => (r ? { ...r, states: r.states.map((s, j) => (j === i ? state : s)), hashes: r.hashes.map((h, j) => (j === i && hash ? hash : h)), error } : r));
  }

  async function sequence(steps: Step[], from: number) {
    if (!client) return;
    for (let i = from; i < steps.length; i++) {
      patch(i, "signing");
      let hash: Hash | undefined;
      try {
        hash = await sendTransactionAsync({ to: steps[i].call.to, data: steps[i].call.data, chainId: robinhoodChain.id });
        patch(i, "pending", hash);
        const receipt = await waitForReceipt(client, hash);
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
        patch(i, "confirmed", hash);
      } catch (err) {
        patch(i, "failed", hash, txError(err));
        return;
      }
    }
  }

  async function start(steps: Step[]) {
    const blank = (mode: Run["mode"]): Run => ({ mode, steps, states: steps.map(() => "waiting"), hashes: steps.map(() => undefined) });
    if (batchOk) {
      setRun({ ...blank("batch"), states: steps.map(() => "signing") });
      try {
        const sent = await sendCallsAsync({ calls: steps.map((s) => s.call), chainId: robinhoodChain.id, forceAtomic: true });
        setRun((r) => (r ? { ...r, batchId: sent.id, states: r.states.map(() => "pending") } : r));
        return;
      } catch (err) {
        if (!isBatchUnsupported(err)) {
          setRun((r) => (r ? { ...r, states: r.states.map(() => "failed"), error: txError(err) } : r));
          return;
        }
      }
    }
    setRun(blank("sequential"));
    await sequence(steps, 0);
  }

  const running = run !== null && (run.states.some((s) => s === "signing" || s === "pending") || (run.error === undefined && run.states.some((s) => s === "waiting")));
  const finished = run !== null && run.states.every((s) => s === "confirmed");
  const failedAt = run?.states.findIndex((s) => s === "failed") ?? -1;
  return { run, running, finished, failedAt, batchOk, start, retry: () => (run ? sequence(run.steps, failedAt) : Promise.resolve()), reset: () => setRun(null) };
}

const STATE_TEXT: Record<StepState, string> = { waiting: "Next", signing: "Confirm in wallet", pending: "Waiting for the chain", confirmed: "Confirmed", failed: "Failed" };

export function StepList({ run }: { run: Run }) {
  return (
    <ol className="mt-5 border-t border-hairline" aria-label="Steps">
      {run.steps.map((s, i) => {
        const st = run.states[i];
        const hash = run.hashes[i];
        return (
          <li key={i} className="flex items-center gap-3 border-b border-hairline py-3 text-[15px]">
            {st === "confirmed" ? <CheckCircle size={20} weight="fill" className="shrink-0 text-kept" aria-hidden />
              : st === "failed" ? <WarningCircle size={20} weight="fill" className="shrink-0 text-loss" aria-hidden />
              : st === "signing" || st === "pending" ? <CircleNotch size={20} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              : <Circle size={20} className="shrink-0 text-mute" aria-hidden />}
            <span className="min-w-0 flex-1">{s.label}</span>
            <span className="text-[13px] text-mute">{STATE_TEXT[st]}</span>
            {hash && (
              <a className="figure inline-flex items-center gap-1 text-[13px] underline underline-offset-4" href={txUrl(hash)} target="_blank" rel="noreferrer">
                {hash.slice(0, 8)}...{hash.slice(-4)} <ArrowSquareOut size={14} aria-hidden />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
