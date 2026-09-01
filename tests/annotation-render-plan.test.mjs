import assert from "node:assert/strict";
import test from "node:test";

import { planCommittedRender } from "../dist/annotation/render-plan.js";

function state(strokeIds, overrides = {}) {
  return {
    displayId: 10,
    viewportWidth: 1920,
    viewportHeight: 1080,
    canvasWidth: 1920,
    canvasHeight: 1080,
    strokeIds,
    ...overrides,
  };
}

test("the first committed render clears and paints the full document", () => {
  assert.deepEqual(planCommittedRender(null, state(["a", "b"])), {
    reset: true,
    appendFrom: 0,
  });
});

test("append-only documents paint only newly committed strokes", () => {
  assert.deepEqual(
    planCommittedRender(state(["a", "b"]), state(["a", "b", "c"])),
    { reset: false, appendFrom: 2 },
  );
});

test("unchanged visible documents do not repaint", () => {
  assert.deepEqual(
    planCommittedRender(state(["a", "b"]), state(["a", "b"])),
    { reset: false, appendFrom: 2 },
  );
});

test("removal, insertion, or reordering forces a full repaint", () => {
  assert.equal(planCommittedRender(state(["a", "b"]), state(["a"])).reset, true);
  assert.equal(
    planCommittedRender(state(["a", "c"]), state(["a", "b", "c"])).reset,
    true,
  );
  assert.equal(
    planCommittedRender(state(["a", "b"]), state(["b", "a"])).reset,
    true,
  );
});

test("display, viewport, and backing-store changes force a full repaint", () => {
  assert.equal(
    planCommittedRender(state(["a"]), state(["a"], { displayId: 20 })).reset,
    true,
  );
  assert.equal(
    planCommittedRender(
      state(["a"]),
      state(["a"], { viewportWidth: 1280 }),
    ).reset,
    true,
  );
  assert.equal(
    planCommittedRender(
      state(["a"]),
      state(["a"], { canvasWidth: 3840 }),
    ).reset,
    true,
  );
});

test("large append-only documents retain constant drawing work", () => {
  const previous = Array.from({ length: 20_000 }, (_, index) => `stroke-${index}`);
  const next = [...previous, "stroke-20000"];
  assert.deepEqual(planCommittedRender(state(previous), state(next)), {
    reset: false,
    appendFrom: 20_000,
  });
});
