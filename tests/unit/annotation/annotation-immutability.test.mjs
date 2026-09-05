import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory } from "../../../dist/annotation/history.js";

function stroke(id, x = 5) {
  return {
    id,
    tool: "pen",
    color: "#000000",
    width: 4,
    opacity: 1,
    points: [
      { x, y: 10 },
      { x: x + 10, y: 15 },
    ],
  };
}

function history() {
  const h = new AnnotationHistory();
  h.setDisplayViewport(1, 100, 100);
  h.addElement(1, stroke("a"));
  return h;
}

test("snapshots are deeply frozen while caller-owned input remains writable", () => {
  const h = new AnnotationHistory();
  const input = stroke("input");
  h.setDisplayViewport(1, 100, 100);
  h.addElement(1, input);
  const view = h.getSnapshot(1);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.viewport));
  assert.ok(Object.isFrozen(view.elements));
  assert.ok(Object.isFrozen(view.elements[0]));
  assert.ok(Object.isFrozen(view.elements[0].points));
  assert.ok(Object.isFrozen(view.elements[0].points[0]));
  assert.throws(() => {
    view.revision = -1;
  }, TypeError);
  assert.throws(() => {
    view.viewport.width = 20;
  }, TypeError);
  assert.throws(() => {
    view.elements.push(stroke("injected"));
  }, TypeError);
  assert.throws(() => {
    view.elements[0].color = "#FFFFFF";
  }, TypeError);
  assert.throws(() => {
    view.elements[0].points[0].x = 900;
  }, TypeError);
  input.points[0].x = 500;
  input.points.push({ x: 80, y: 80 });
  assert.equal(view.elements[0].points[0].x, 5);
  assert.equal(view.elements[0].points.length, 2);
});

test("same-revision reads reuse a snapshot and appends share existing immutable geometry", () => {
  const h = history();
  const first = h.getSnapshot(1);
  for (let i = 0;i < 1000;i += 1) assert.equal(h.getSnapshot(1), first);
  h.addElement(1, stroke("b"));
  const second = h.getSnapshot(1);
  assert.notEqual(second, first);
  assert.equal(first.elements.length, 1);
  assert.equal(second.elements.length, 2);
  assert.equal(second.elements[0], first.elements[0]);
  assert.equal(second.elements[0].points, first.elements[0].points);
  assert.ok(second.revision > first.revision);
  h.addElement(2, stroke("other"));
  assert.equal(h.getSnapshot(1), second);
});

test("Undo, Redo, deletion and Clear invalidate only changed views without changing old snapshots", () => {
  const h = history();
  const original = h.getSnapshot(1);
  h.removeElements(1, ["a"]);
  const deleted = h.getSnapshot(1);
  assert.equal(deleted.elements.length, 0);
  h.undo();
  const restored = h.getSnapshot(1);
  assert.equal(restored.elements[0], original.elements[0]);
  h.redo();
  assert.equal(h.getSnapshot(1).elements.length, 0);
  h.undo();
  h.clearDisplay(1);
  h.undo();
  assert.equal(h.getSnapshot(1).elements[0], original.elements[0]);
  assert.equal(original.elements.length, 1);
  assert.equal(deleted.elements.length, 0);
  assert.equal(restored.elements.length, 1);
});

test("viewport scaling replaces geometry and leaves previous snapshots and checkpoints unchanged", () => {
  const h = history();
  const before = h.getSnapshot(1);
  const checkpoint = h.clone();
  h.setDisplayViewport(1, 200, 50);
  const resized = h.getSnapshot(1);
  assert.notEqual(resized.elements[0], before.elements[0]);
  assert.deepEqual(resized.elements[0].points[0], { x: 10, y: 5 });
  assert.deepEqual(before.elements[0].points[0], { x: 5, y: 10 });
  assert.deepEqual(checkpoint.getSnapshot(1), before);
  h.undo();
  h.redo();
  assert.deepEqual(h.getSnapshot(1).elements, resized.elements);
  h.restoreFrom(checkpoint);
  const rolledBack = h.getSnapshot(1);
  assert.deepEqual(rolledBack, before);
  assert.notEqual(rolledBack, resized);
  assert.equal(rolledBack.elements[0], before.elements[0]);
  checkpoint.clearDisplay(1);
  assert.equal(h.getSnapshot(1).elements.length, 1);
});

test("no-op and rejected operations retain the cached snapshot", () => {
  const h = history();
  const view = h.getSnapshot(1);
  assert.equal(h.setDisplayViewport(1, 100, 100), false);
  assert.equal(h.removeElements(1, ["absent"]), null);
  assert.equal(h.redo(), null);
  assert.throws(() => h.addElement(1, stroke("a")));
  assert.throws(() => h.addElement(1, { ...stroke("bad"), width: Infinity }));
  assert.equal(h.getSnapshot(1), view);
  h.restoreFrom(h);
  assert.equal(h.getSnapshot(1), view);
});

test("disconnected-display removal invalidates its cache without changing retained snapshots", () => {
  const h = history();
  h.addElement(2, stroke("other"));
  const first = h.getSnapshot(1);
  const oldOther = h.getSnapshot(2);
  h.retainDisplays([1]);
  assert.equal(h.getSnapshot(1), first);
  assert.equal(h.getSnapshot(2).elements.length, 0);
  assert.equal(oldOther.elements.length, 1);
});

test("snapshots remain ordinary structured-cloneable IPC data", () => {
  const h = history();
  const source = h.getSnapshot(1);
  const transported = structuredClone(source);
  assert.deepEqual(transported, source);
  transported.elements[0].points[0].x = 700;
  assert.equal(h.getSnapshot(1).elements[0].points[0].x, 5);
});

test("retained snapshots stay unchanged across randomized editing and checkpoints", () => {
  const h = history();
  const views = [];
  let seed = 0x51a7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0;i < 2000;i += 1) {
    const display = 1 + (next() % 2);
    const op = next() % 7;
    if (op < 2) h.addElement(display, stroke(`s-${i}`));
    else if (op === 2) h.undo();
    else if (op === 3) h.redo();
    else if (op === 4) h.clearDisplay(display);
    else if (op === 5)
      h.setDisplayViewport(display, 100 + (next() % 3) * 50, 100);
    else {
      const c = h.clone();
      h.addElement(display, stroke(`temporary-${i}`));
      h.restoreFrom(c);
    }
    if (i % 40 === 0) {
      const view = h.getSnapshot(display);
      views.push([view, JSON.stringify(view)]);
    }
    for (const [view, serialized] of views)
      assert.equal(JSON.stringify(view), serialized);
  }
});
