import assert from "node:assert/strict";
import test from "node:test";

import { CoalescingSerialExecutor } from "../../../dist/electron/serial-executor.js";

test("display refresh requests never overlap and coalesce bursts", async () => {
  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const executor = new CoalescingSerialExecutor(async () => {
    calls += 1;
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    if (calls === 1) await firstGate;
    running -= 1;
  });

  const first = executor.request();
  executor.request();
  executor.request();
  releaseFirst();
  await first;

  assert.equal(maxRunning, 1);
  assert.equal(calls, 2);
});
