import assert from "node:assert/strict";
import test from "node:test";

import { resolveClearDisplayId } from "../../../dist/electron/annotation-target.js";

test("controller clear targets the last annotated connected display", () => {
  assert.equal(resolveClearDisplayId("controller", 20, 10, [10, 20]), 10);
});

test("controller clear falls back when the last annotated display disconnected", () => {
  assert.equal(resolveClearDisplayId("controller", 20, 10, [20, 30]), 20);
});

test("shortcut clear follows the cursor display rather than controller history", () => {
  assert.equal(resolveClearDisplayId("shortcut", 20, 10, [10, 20]), 20);
});

test("clear targeting has deterministic first-display and no-display fallbacks", () => {
  assert.equal(resolveClearDisplayId("controller", 99, null, [30, 40]), 30);
  assert.equal(resolveClearDisplayId("shortcut", 99, 30, []), null);
});
