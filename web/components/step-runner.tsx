"use client";

import { Fragment, useRef, useState } from "react";
import { type Hash } from "viem";
import { useAccount, useCapabilities, useConfig, usePublicClient, useSendCalls, useSendTransaction } from "wagmi";
import { waitForCallsStatus } from "wagmi/actions";
import { ArrowSquareOut, CheckCircle, Circle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { robinhoodChain, txUrl } from "@/lib/chain";
import { PARENT_BLOCK_SECONDS, isBatchUnsupported, supportsAtomicBatch, type Step } from "@/lib/morpho";
import { depositParentBlock, waitForParentBlockAfter } from "@/lib/parent-block";
import { knownRevert } from "@/lib/revert";
import { runPhases } from "@/lib/run-phases";
import { errMessage, waitForReceipt } from "@/lib/tx";

export type StepState = "waiting" | "signing" | "pending" | "confirmed" | "failed";
export type Run = {
  mode: "batch" | "sequential";
  /** Every step of every phase, in order. */
  steps: Step[];
  /** Index in `steps` of the first step of each phase. */
  starts: number[];
  states: StepState[];
  hashes: (Hash | undefined)[];
  error?: string;
  /** Set while the run waits for the next parent-chain block: the index of the first step of the phase that is held back. */
  waitingAt?: number;
  /** False after a batch the wallet never reported on: sending it again could double it. */
  retryable: boolean;
};

const txError = (err: unknown): string => knownRevert(err)?.copy ?? errMessage(err);
const WAIT_TEXT = `Waiting for the next block, about ${PARENT_BLOCK_SECONDS} seconds`;

/** Button text while a run is in flight. */
export const runLabel = (run: Run | null): string =>
  run?.waitingAt !== undefined ? "Waiting for the next block" : run?.mode === "batch" ? "Confirm in your wallet" : "Working through the steps";

/** Runs a list of phases. Each phase is one EIP-5792 batch when the wallet batches atomically, and one transaction per step when it cannot. The vault refuses to move shares
 *  minted in the current parent-chain block, so the next phase starts only once the parent chain's block number is above the one the previous phase mined in
 *  (web/lib/parent-block.ts). A user rejection or a revert stops the run: only "this wallet cannot batch here" falls back. `batchOk` is what the wallet reported for Robinhood Chain. */
export function useStepRunner() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [run, setRun] = useState<Run | null>(null);
  const onChain = Boolean(address && chainId === robinhoodChain.id);
  const caps = useCapabilities({ account: address, query: { enabled: onChain } });
  const batchOk = supportsAtomicBatch(caps.data, robinhoodChain.id);
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();
  /** What the async loop needs between renders: the phases, the mode, the L2 block each finished phase mined in, and the id of the live run (reset or a new start retires the old one). */
  const live = useRef<{ id: number; phases: Step[][]; starts: number[]; mode: Run["mode"]; blocks: (bigint | undefined)[] }>({ id: 0, phases: [], starts: [], mode: "sequential", blocks: [] });

  const current = (id: number) => live.current.id === id;
  const update = (id: number, f: (r: Run) => Run) => { if (current(id)) setRun((r) => (r ? f(r) : r)); };
  const setStates = (id: number, from: number, to: number, state: StepState, extra?: Partial<Run>) =>
    update(id, (r) => ({ ...r, ...extra, states: r.states.map((s, j) => (j >= from && j < to ? state : s)) }));
  const setHashes = (id: number, from: number, to: number, hash: Hash | undefined) =>
    update(id, (r) => ({ ...r, hashes: r.hashes.map((h, j) => (j >= from && j < to && hash ? hash : h)) }));

  /** Holds the next phase back until the parent chain has produced a block after the one the previous phase mined in. */
  async function gate(id: number, k: number): Promise<boolean> {
    const first = live.current.starts[k];
    update(id, (r) => ({ ...r, waitingAt: first, error: undefined }));
    try {
      if (!client) throw new Error("No connection to Robinhood Chain.");
      const after = await depositParentBlock(client, live.current.blocks[k - 1]);
      await waitForParentBlockAfter(client, after);
      update(id, (r) => ({ ...r, waitingAt: undefined }));
      return true;
    } catch (err) {
      setStates(id, first, first + 1, "failed", { waitingAt: undefined, error: errMessage(err), retryable: true });
      return false;
    }
  }

  /** One phase. Returns false when it stopped (the run's error is set). `fromStep` restarts a sequential phase part-way. */
  async function runPhase(id: number, k: number, fromStep: number): Promise<boolean> {
    const { phases, starts } = live.current;
    const steps = phases[k];
    const base = starts[k];
    const end = base + steps.length;
    let block: bigint | undefined;

    if (live.current.mode === "batch" && fromStep === 0) {
      setStates(id, base, end, "signing");
      let sentId: string | undefined;
      try {
        sentId = (await sendCallsAsync({ calls: steps.map((s) => s.call), chainId: robinhoodChain.id, forceAtomic: true })).id;
      } catch (err) {
        if (!isBatchUnsupported(err)) {
          setStates(id, base, end, "failed", { error: txError(err), retryable: true });
          return false;
        }
        live.current.mode = "sequential";
        update(id, (r) => ({ ...r, mode: "sequential" }));
        setStates(id, base, end, "waiting");
      }
      if (sentId !== undefined) {
        setStates(id, base, end, "pending");
        try {
          const done = await waitForCallsStatus(config, { id: sentId, timeout: 180_000, pollingInterval: 2_000 });
          if (done.status !== "success") {
            const kept = k > 0 ? " Your deposit from the first batch is confirmed and its shares are in your wallet." : "";
            setStates(id, base, end, "failed", { error: `The batch reverted on-chain. Nothing in it took effect.${kept}`, retryable: true });
            return false;
          }
          const receipts = done.receipts ?? [];
          setHashes(id, base, end, receipts.at(-1)?.transactionHash);
          block = receipts.reduce<bigint | undefined>((hi, rc) => (rc.blockNumber !== undefined && (hi === undefined || rc.blockNumber > hi) ? rc.blockNumber : hi), undefined);
          setStates(id, base, end, "confirmed");
        } catch (err) {
          setStates(id, base, end, "failed", { error: `The wallet did not report the batch as confirmed within three minutes. Check it before trying again. ${errMessage(err)}`, retryable: false });
          return false;
        }
        live.current.blocks[k] = block;
        return true;
      }
    }

    if (!client) {
      setStates(id, base + fromStep, end, "failed", { error: "No connection to Robinhood Chain.", retryable: true });
      return false;
    }
    for (let i = fromStep; i < steps.length; i++) {
      if (!current(id)) return false;
      const at = base + i;
      setStates(id, at, at + 1, "signing", { error: undefined });
      let hash: Hash | undefined;
      try {
        hash = await sendTransactionAsync({ to: steps[i].call.to, data: steps[i].call.data, chainId: robinhoodChain.id });
        setStates(id, at, at + 1, "pending");
        setHashes(id, at, at + 1, hash);
        const receipt = await waitForReceipt(client, hash);
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
        block = receipt.blockNumber;
        setStates(id, at, at + 1, "confirmed");
      } catch (err) {
        setStates(id, at, at + 1, "failed", { error: txError(err), retryable: true });
        return false;
      }
    }
    live.current.blocks[k] = block;
    return true;
  }

  const drive = (id: number, k0: number, fromStep: number) =>
    runPhases({ count: live.current.phases.length, k0, fromStep, current: () => current(id), gate: (k) => gate(id, k), phase: (k, from) => runPhase(id, k, from) });

  async function start(phases: Step[][]) {
    const steps = phases.flat();
    const starts = phases.map((_, k) => phases.slice(0, k).reduce((n, p) => n + p.length, 0));
    const mode: Run["mode"] = batchOk ? "batch" : "sequential";
    const id = live.current.id + 1;
    live.current = { id, phases, starts, mode, blocks: [] };
    setRun({ mode, steps, starts, states: steps.map(() => "waiting"), hashes: steps.map(() => undefined), retryable: true });
    await drive(id, 0, 0);
  }

  const running = run !== null && (run.states.some((s) => s === "signing" || s === "pending") || (run.error === undefined && run.states.some((s) => s === "waiting")));
  const finished = run !== null && run.states.every((s) => s === "confirmed");
  const failedAt = run?.states.findIndex((s) => s === "failed") ?? -1;
  const canRetry = failedAt >= 0 && run?.retryable === true;

  /** Picks the run up where it stopped: a sequential run at the failed step, a batch at the start of the phase that failed. */
  async function retry() {
    if (!run || !canRetry) return;
    const { id, starts } = live.current;
    const k = starts.reduce((acc, s, j) => (failedAt >= s ? j : acc), 0);
    const fromStep = live.current.mode === "sequential" ? failedAt - starts[k] : 0;
    const from = starts[k] + fromStep;
    const end = k + 1 < starts.length ? starts[k + 1] : run.steps.length;
    setRun((r) => (r ? { ...r, error: undefined, states: r.states.map((s, j) => (j >= from && j < end ? "waiting" : s)) } : r));
    await drive(id, k, fromStep);
  }

  return { run, running, finished, failedAt, canRetry, batchOk, start, retry, reset: () => { live.current.id += 1; setRun(null); } };
}

const STATE_TEXT: Record<StepState, string> = { waiting: "Next", signing: "Confirm in wallet", pending: "Waiting for the chain", confirmed: "Confirmed", failed: "Failed" };

export function StepList({ run }: { run: Run }) {
  return (
    <ol className="mt-5 border-t border-hairline" aria-label="Steps">
      {run.steps.map((s, i) => {
        const st = run.states[i];
        const hash = run.hashes[i];
        return (
          <Fragment key={i}>
            {run.waitingAt === i && (
              <li role="status" className="flex items-center gap-3 border-b border-hairline py-3 text-[15px]">
                <CircleNotch size={20} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                <span className="min-w-0 flex-1">{WAIT_TEXT}</span>
              </li>
            )}
            <li className="flex items-center gap-3 border-b border-hairline py-3 text-[15px]">
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
          </Fragment>
        );
      })}
    </ol>
  );
}
