import assert from "node:assert/strict";
import test from "node:test";
import { sameAnnotationInputViewport as same } from "../../../dist/annotation/viewport.js";

test("input viewport tracks CSS dimensions separately from backing-store dimensions", () => {
  const a = { width: 800, height: 600, ratio: 2 }, b = { width: 1600, height: 1200, ratio: 1 };
  assert.equal(a.width * a.ratio, b.width * b.ratio); assert.equal(same(a, b), false);
});
test("pure DPR changes cancel input, redundant notifications and unchanged DPR do not", () => {
  const current = { width: 800, height: 600, ratio: 1.25 };
  assert.equal(same(null, current), false); assert.equal(same(current, { ...current }), true);
  for (const change of [{ width: 801 }, { height: 601 }, { ratio: 1.5 }]) assert.equal(same(current, { ...current, ...change }), false);
});
