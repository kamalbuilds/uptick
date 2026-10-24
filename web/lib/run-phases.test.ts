import assert from "node:assert/strict";
import { test } from "node:test";
import { runPhases } from "./run-phases.ts";

/** Records what a run sent, and lets a test retire the run at a chosen moment. */
function harness(opts: { retireDuringWaitOf?: number } = {}) {
  const log: string[] = [];
  let id = 1;
  const mine = 1;
  return {
    log,
    retire: () => { id += 1; },
    drive: (count: number, k0 = 0, fromStep = 0) =>
      runPhases({
        count, k0, fromStep,
        current: () => id === mine,
        gate: async (k) => {
          log.push(`wait ${k}`);
          if (opts.retireDuringWaitOf === k) id += 1;
          return true;
        },
        phase: async (k, from) => { log.push(`send ${k}@${from}`); return true; },
      }),
  };
}

test("two phases: the second is sent only after the wait", async () => {
  const h = harness();
  await h.drive(2);
  assert.deepEqual(h.log, ["send 0@0", "wait 1", "send 1@0"]);
});

test("a run retired during the wait sends nothing for phase 2", async () => {
  const h = harness({ retireDuringWaitOf: 1 });
  await h.drive(2);
  assert.deepEqual(h.log, ["send 0@0", "wait 1"]);
});

test("a run retired before it starts sends nothing", async () => {
  const h = harness();
  h.retire();
  await h.drive(2);
  assert.deepEqual(h.log, []);
});

test("a failed wait stops the run", async () => {
  const sent: number[] = [];
  await runPhases({ count: 2, k0: 0, fromStep: 0, current: () => true, gate: async () => false, phase: async (k) => { sent.push(k); return true; } });
  assert.deepEqual(sent, [0]);
});

test("a retry part-way through phase 2 skips the wait and resumes at that step", async () => {
  const h = harness();
  await h.drive(2, 1, 1);
  assert.deepEqual(h.log, ["send 1@1"]);
});

test("a retry at the start of phase 2 waits again before sending", async () => {
  const h = harness();
  await h.drive(2, 1, 0);
  assert.deepEqual(h.log, ["wait 1", "send 1@0"]);
});
