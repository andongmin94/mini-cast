import assert from "node:assert/strict";
import test from "node:test";
import { planCommittedRender } from "../dist/annotation/render-plan.js";
import { paintCommittedAnnotations } from "../dist/annotation/canvas-renderer.js";

const stroke = (id, x = 10, y = 10) => ({
  id,
  tool: "pen",
  width: 4,
  color: "#FF0000",
  opacity: 1,
  points: [
    { x, y },
    { x: x + 10, y: y + 10 },
  ],
});
const state = (strokes, overrides = {}) => ({
  displayId: 1,
  viewportWidth: 1920,
  viewportHeight: 1080,
  canvasWidth: 1920,
  canvasHeight: 1080,
  pixelRatio: 1,
  strokes,
  ...overrides,
});

test("initial paint clears the whole backing store and append paints only new strokes", () => {
  const a = stroke("a"),
    b = stroke("b");
  const initial = planCommittedRender(null, state([a]));
  assert.equal(initial.kind, "full");
  assert.deepEqual(initial.clear, { x: 0, y: 0, width: 1920, height: 1080 });
  const appended = planCommittedRender(state([a]), state([a, b]));
  assert.equal(appended.kind, "append");
  assert.equal(appended.clear, null);
  assert.deepEqual(appended.strokes, [b]);
  assert.equal(planCommittedRender(state([a]), state([a])).kind, "none");
});

test("local deletion repaints only intersecting strokes in their original compositing order", () => {
  const a = stroke("a"),
    b = {
      ...stroke("highlight"),
      tool: "highlighter",
      opacity: 0.35,
      width: 16,
    },
    c = stroke("distant", 1000, 700);
  const plan = planCommittedRender(state([a, b, c]), state([b, c]));
  assert.equal(plan.kind, "dirty");
  assert.deepEqual(plan.strokes, [b]);
  assert.ok(plan.clear.width * plan.clear.height < (1920 * 1080) / 100);
});

test("Undo insertion beneath existing ink redraws the whole intersecting stack only once", () => {
  const a = stroke("a"),
    b = { ...stroke("b"), tool: "highlighter", opacity: 0.35 },
    c = stroke("c", 900, 600);
  const plan = planCommittedRender(state([b, c]), state([a, b, c]));
  assert.equal(plan.kind, "dirty");
  assert.deepEqual(plan.strokes, [a, b]);
});

test("reordering retained translucent strokes invalidates their composited bounds", () => {
  const a = { ...stroke("a"), tool: "highlighter", opacity: 0.35 };
  const b = {
    ...stroke("b"),
    tool: "highlighter",
    opacity: 0.35,
    color: "#0000FF",
  };
  const plan = planCommittedRender(state([a, b]), state([b, a]));
  assert.equal(plan.kind, "dirty");
  assert.deepEqual(plan.strokes, [b, a]);
});

test("same IDs with replaced geometry or style do not reuse stale pixels", () => {
  const a = stroke("a");
  const moved = stroke("a", 100, 100);
  const plan = planCommittedRender(state([a]), state([moved]));
  assert.equal(plan.kind, "dirty");
  assert.ok(plan.clear.x <= 8);
  assert.ok(plan.clear.x + plan.clear.width >= 112);
  assert.deepEqual(plan.strokes, [moved]);
});

test("viewport, display, backing store and DPR changes force complete repaint", () => {
  const a = stroke("a");
  for (const change of [
    { displayId: 2 },
    { viewportWidth: 1280 },
    { canvasWidth: 2400 },
    { pixelRatio: 1.25 },
  ])
    assert.equal(
      planCommittedRender(state([a]), state([a], change)).kind,
      "full",
    );
});

test("dirty rectangles are device-pixel aligned and clamped at fractional DPI and screen edges", () => {
  const a = { ...stroke("edge", -1.25, 0.3), width: 7.5 };
  for (const ratio of [1, 1.25, 1.5, 2, 2.5]) {
    const s = state([a], { pixelRatio: ratio });
    const plan = planCommittedRender(s, { ...s, strokes: [] });
    assert.equal(plan.kind, "dirty");
    for (const value of Object.values(plan.clear))
      assert.ok(Number.isInteger(value));
    assert.equal(plan.clear.x, 0);
    assert.equal(plan.clear.y, 0);
  }
});

test("Clear clears prior ink bounds and an offscreen deletion does not repaint", () => {
  const a = stroke("a");
  const plan = planCommittedRender(state([a]), state([]));
  assert.equal(plan.kind, "dirty");
  assert.deepEqual(plan.strokes, []);
  assert.equal(
    planCommittedRender(state([stroke("away", 5000, 5000)]), state([])).kind,
    "none",
  );
});

test("a 1000-stroke local deletion avoids drawing unrelated geometry", () => {
  const strokes = Array.from({ length: 1000 }, (_, i) =>
    stroke(String(i), (i % 40) * 40, Math.floor(i / 40) * 35),
  );
  const plan = planCommittedRender(state(strokes), state(strokes.slice(1)));
  assert.equal(plan.kind, "dirty");
  assert.ok(plan.strokes.length < 5);
  console.log(
    "DIRTY_REGION_WORK",
    JSON.stringify({
      documentStrokes: strokes.length,
      drawnStrokes: plan.strokes.length,
      clearedPixels: plan.clear.width * plan.clear.height,
      fullPixels: 1920 * 1080,
    }),
  );
});

test("painting clips and clears in device pixels, then restores the context even on draw failure", () => {
  const calls = [];
  const context = {
    save() {
      calls.push("save");
    },
    restore() {
      calls.push("restore");
    },
    setTransform(...x) {
      calls.push(["transform", ...x]);
    },
    beginPath() {
      calls.push("path");
    },
    rect(...x) {
      calls.push(["rect", ...x]);
    },
    clip() {
      calls.push("clip");
    },
    clearRect(...x) {
      calls.push(["clear", ...x]);
    },
    moveTo() {
      throw new Error("draw failure");
    },
    lineTo() {},
    stroke() {},
  };
  const a = stroke("a"),
    b = stroke("b");
  assert.throws(
    () => paintCommittedAnnotations(context, state([a, b]), state([b])),
    /draw failure/,
  );
  assert.ok(
    calls.indexOf("clip") <
      calls.findIndex((x) => Array.isArray(x) && x[0] === "clear"),
  );
  assert.equal(calls.at(-1), "restore");
});
