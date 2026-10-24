export type PhaseDriver = {
  /** Number of phases in the run. */
  count: number;
  /** First phase to run, and the step inside it to start from. */
  k0: number;
  fromStep: number;
  /** False once the run was reset or replaced: nothing more may be sent for it. */
  current: () => boolean;
  /** Holds phase `k` back (the wait for the next parent-chain block). False when the wait failed. */
  gate: (k: number) => Promise<boolean>;
  /** Sends phase `k` from step `from`. False when it stopped. */
  phase: (k: number, from: number) => Promise<boolean>;
};

/** Runs phases in order. The run is checked again after every await, so a run retired during the wait for the next block sends nothing. */
export async function runPhases({ count, k0, fromStep, current, gate, phase }: PhaseDriver): Promise<void> {
  for (let k = k0; k < count; k++) {
    if (!current()) return;
    const from = k === k0 ? fromStep : 0;
    if (k > 0 && from === 0) {
      if (!(await gate(k))) return;
      if (!current()) return;
    }
    if (!(await phase(k, from))) return;
  }
}
