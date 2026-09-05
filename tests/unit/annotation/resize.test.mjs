import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, resizeAnnotationElement, MAX_ANNOTATION_COORDINATE } from "../../../dist/annotation/history.js";
import { annotationSelectionBounds, applyAnnotationSelectionEdit, readAnnotationSelectionEdit, resizeSelectionElements } from "../../../dist/annotation/selection.js";
import { RESIZE_HANDLES, RESIZE_HANDLE_SIZE, resizeHandleDisplayBounds, isResizeHandle, resizeHandlePoint, selectionResizeTransform } from "../../../dist/annotation/resize.js";
import { AnnotationReplica, createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const box = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
const rectangle = (id = "a") => ({ id, tool: "rectangle", color: "#007AFF", opacity: 1, width: 4,
  points: [{ x: 20, y: 30 }, { x: 120, y: 90 }] });
const text = { id: "text", tool: "text", color: "#123456", opacity: 1,
  points: [{ x: 140, y: 110 }], text: "한글\ntext", fontSize: 28, scaleX: 1.25, scaleY: 0.8,
  box: { minX: -2, minY: -22, maxX: 70, maxY: 34 } };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function setup() {
  const history = new AnnotationHistory();
  history.setDisplayViewport(1, 800, 600);
  history.addElement(1, rectangle());
  history.addElement(1, { ...rectangle("untouched"), points: [{ x: 450, y: 300 }, { x: 500, y: 350 }] });
  history.addElement(1, text);
  return history;
}
function resize(history, ids = ["a", "text"], handle = "se", dx = 35, dy = 20, lockAspect = false) {
  return applyAnnotationSelectionEdit(history, 1, {
    kind: "resize", revision: history.getSnapshot(1).revision, ids, handle, dx, dy, lockAspect,
  });
}
function unchangedOnFailure(history, action, reason = "invalid-element") {
  const before = history.getSnapshot(1);
  const undo = history.canUndo, redo = history.canRedo;
  assert.throws(action, error => error.reason === reason);
  assert.strictEqual(history.getSnapshot(1), before);
  assert.equal(history.canUndo, undo);
  assert.equal(history.canRedo, redo);
}

test("four resize handles use the opposite corner and do not jump on pointer-down", () => {
  const opposites = { nw: "se", ne: "sw", sw: "ne", se: "nw" };
  for (const handle of RESIZE_HANDLES) {
    const transform = selectionResizeTransform(box, handle, 0, 0, false);
    assert.deepEqual(transform.anchor, resizeHandlePoint(box, opposites[handle]));
    assert.equal(transform.scaleX, 1);
    assert.equal(transform.scaleY, 1);
    const signX = handle.endsWith("w") ? -1 : 1;
    const signY = handle.startsWith("n") ? -1 : 1;
    const grown = selectionResizeTransform(box, handle, signX * 50, signY * 25, false);
    assert.equal(grown.scaleX, 1.5); assert.equal(grown.scaleY, 1.5);
  }
  assert.equal(isResizeHandle("rotate"), false);
});

test("Shift projects onto the starting diagonal and keeps both axes at the same ratio", () => {
  const free = selectionResizeTransform(box, "se", 40, 10, false);
  close(free.scaleX, 1.4); close(free.scaleY, 1.2);
  const locked = selectionResizeTransform(box, "se", 40, 10, true);
  close(locked.scaleX, 1.36); close(locked.scaleY, 1.36);
});

test("crossing an opposite corner never flips or collapses the geometry", () => {
  const stopped = selectionResizeTransform(box, "se", -1000, -1000, false);
  close(stopped.scaleX, 0.02); close(stopped.scaleY, 0.04);
  const locked = selectionResizeTransform(box, "se", -1000, -1000, true);
  close(locked.scaleX, 0.04); close(locked.scaleY, 0.04);
  const tiny = selectionResizeTransform({ minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 }, "se", 0, 0, false);
  assert.equal(tiny.scaleX, 1); assert.equal(tiny.scaleY, 1);
});

test("resize math rejects degenerate bounds, unsupported handles and nonfinite values", () => {
  for (const bounds of [{ ...box, maxX: box.minX }, { ...box, maxY: Infinity }, { ...box, minY: NaN }]) {
    assert.throws(() => selectionResizeTransform(bounds, "se", 1, 1, false));
  }
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => selectionResizeTransform(box, "se", bad, 1, false));
  assert.throws(() => selectionResizeTransform(box, "rotation", 1, 1, false));
});

test("resize IPC validates handle, ratio policy, ids, offsets and revision", () => {
  const valid = { kind: "resize", revision: 8, ids: ["a"], handle: "se", dx: 5, dy: -2, lockAspect: false };
  assert.deepEqual(readAnnotationSelectionEdit(valid), valid);
  for (const value of [{ ...valid, handle: "center" }, { ...valid, lockAspect: undefined },
    { ...valid, lockAspect: 1 }, { ...valid, revision: -1 }, { ...valid, revision: 0.5 },
    { ...valid, ids: ["a", "a"] }, { ...valid, ids: [] }, { ...valid, dx: Infinity },
    { ...valid, dy: 3 * MAX_ANNOTATION_COORDINATE }]) assert.equal(readAnnotationSelectionEdit(value), null);
});

for (const tool of ["pen", "highlighter", "line", "arrow", "rectangle", "ellipse", "text"]) {
  test(`${tool} resizes with identical preview and authoritative geometry`, () => {
    const source = tool === "text" ? text : { ...rectangle(tool), tool, opacity: tool === "highlighter" ? 0.35 : 1 };
    const history = new AnnotationHistory(); history.addElement(1, source);
    const before = history.getSnapshot(1);
    const preview = resizeSelectionElements(before.elements, new Set([source.id]), "ne", 24, -13, false);
    resize(history, [source.id], "ne", 24, -13);
    const after = history.getSnapshot(1);
    assert.deepEqual(after.elements, preview);
    assert.equal(after.elements[0].id, source.id);
    assert.equal(after.elements[0].tool, tool);
    assert.equal(after.elements[0].color, source.color);
    assert.equal(after.elements[0].opacity, source.opacity);
    assert.ok(Object.isFrozen(after.elements[0]));
    assert.ok(Object.isFrozen(after.elements[0].points[0]));
    assert.deepEqual(before.elements[0], source);
    history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
    history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
  });
}

test("uniform resizing preserves the opposite visible ink corner", () => {
  const history = setup(); const ids = new Set(["a", "text"]);
  const before = history.getSnapshot(1);
  const bounds = annotationSelectionBounds(before.elements, ids);
  for (const handle of RESIZE_HANDLES) {
    const sx = handle.endsWith("w") ? -1 : 1;
    const sy = handle.startsWith("n") ? -1 : 1;
    const result = resizeSelectionElements(before.elements, ids, handle, sx * 20, sy * 10, true);
    const actual = annotationSelectionBounds(result, ids);
    const pivot = selectionResizeTransform(bounds, handle, sx * 20, sy * 10, true).anchor;
    close(handle.endsWith("w") ? actual.maxX : actual.minX, pivot.x);
    close(handle.startsWith("n") ? actual.maxY : actual.minY, pivot.y);
  }
});

test("one group resize preserves order and untouched references and creates one Undo entry", () => {
  const history = setup(); const before = history.getSnapshot(1);
  resize(history);
  const after = history.getSnapshot(1);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.elements.map(e => e.id), ["a", "untouched", "text"]);
  assert.strictEqual(after.elements[1], before.elements[1]);
  history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
});

test("text resizes its measured layout and both axes without rewriting content or font size", () => {
  const next = resizeAnnotationElement(text, { x: 10, y: 20 }, 2, 0.5);
  assert.deepEqual(next.points, [{ x: 270, y: 65 }]);
  close(next.scaleX, 2.5); close(next.scaleY, 0.4);
  assert.equal(next.text, text.text); assert.equal(next.fontSize, text.fontSize);
  assert.deepEqual(next.box, text.box); assert.ok(Object.isFrozen(next.box));
  const ink = resizeAnnotationElement(rectangle(), { x: 10, y: 20 }, 2, 0.5);
  assert.equal(ink.width, 4);
});

test("single-point ink can be resized and a horizontal line never divides by zero", () => {
  const history = new AnnotationHistory();
  history.addElement(1, { ...rectangle("dot"), tool: "pen", points: [{ x: 20, y: 20 }] });
  resize(history, ["dot"], "se", 4, 4, true);
  assert.equal(history.getSnapshot(1).elements[0].width, 8);
  history.addElement(1, { ...rectangle("line"), tool: "line", points: [{ x: 10, y: 70 }, { x: 100, y: 70 }] });
  resize(history, ["line"], "se", 15, 0);
  assert.ok(history.getSnapshot(1).elements[1].points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("identity resize preserves snapshot identity, Redo, and the history stack", () => {
  const history = setup(); history.undo(); const before = history.getSnapshot(1);
  assert.equal(resize(history, ["a"], "nw", 0, 0, true), null);
  assert.strictEqual(history.getSnapshot(1), before); assert.equal(history.canRedo, true);
  assert.strictEqual(resizeSelectionElements(before.elements, new Set(["a"]), "nw", 0, 0, false), before.elements);
});

test("coordinate, width or text-scale overflow rejects a complete group before editing", () => {
  const history = setup();
  unchangedOnFailure(history, () => history.resizeElements(1, ["a", "text"], { x: 0, y: 0 }, 1000000, 1));
  history.addElement(1, { ...rectangle("wide"), width: 128 });
  unchangedOnFailure(history, () => history.resizeElements(1, ["a", "wide"], { x: 0, y: 0 }, 2, 2));
  for (const scale of [0, -1, NaN, Infinity]) {
    unchangedOnFailure(history, () => history.resizeElements(1, ["a"], { x: 0, y: 0 }, scale, 1));
  }
  unchangedOnFailure(history, () => history.resizeElements(1, ["a"], { x: NaN, y: 0 }, 1, 1));
  assert.throws(() => resizeAnnotationElement({ ...text, scaleX: 100000 }, { x: 0, y: 0 }, 2, 1));
});

test("stale revisions and missing group members cannot partially resize a document", () => {
  const history = setup();
  unchangedOnFailure(history, () => applyAnnotationSelectionEdit(history, 1, {
    kind: "resize", revision: history.getSnapshot(1).revision - 1, ids: ["a"], handle: "se", dx: 10, dy: 10, lockAspect: false,
  }), "stale-document");
  unchangedOnFailure(history, () => resize(history, ["a", "missing"]), "stale-document");
});

test("resize participates in global history and clears Redo only for a real edit", () => {
  const history = setup(); history.addElement(2, rectangle("other"));
  resize(history); assert.equal(history.undo(), 1); assert.equal(history.undo(), 2);
  resize(history, ["a"], "se", 5, 5); assert.equal(history.canRedo, false);
});

test("resize history and checkpoints stay exact after nonuniform display scaling", () => {
  const history = setup(); const before = history.getSnapshot(1);
  resize(history); const checkpoint = history.clone();
  history.setDisplayViewport(1, 1600, 300); const after = history.getSnapshot(1);
  history.undo();
  assert.deepEqual(history.getSnapshot(1).elements[0].points, before.elements[0].points.map(p => ({ x: p.x * 2, y: p.y / 2 })));
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
  history.restoreFrom(checkpoint); history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
});

test("resize sends only changed elements and a delayed reply never resurrects undone geometry", async () => {
  const history = setup(); const before = history.getSnapshot(1);
  const replica = new AnnotationReplica(async () => history.getSnapshot(1), () => {});
  replica.reset(1); await replica.receive({ kind: "snapshot", document: before });
  resize(history, ["text"]); const resized = history.getSnapshot(1);
  const reply = createAnnotationUpdate(before, resized);
  assert.equal(reply.kind, "delta"); assert.deepEqual(reply.removedIds, ["text"]); assert.equal(reply.inserted.length, 1);
  assert.deepEqual(reduceAnnotationUpdate(before, 1, reply).document, resized);
  history.undo(); const undone = history.getSnapshot(1);
  await replica.receive(createAnnotationUpdate(resized, undone)); await replica.receive(reply);
  assert.deepEqual(replica.document, undone);
});

test("500 mixed corner resizes retain original snapshots and exact Undo/Redo values", () => {
  const history = setup(); const original = history.getSnapshot(1);
  for (let index = 0; index < 500; index += 1) {
    const before = history.getSnapshot(1);
    resize(history, ["a", "text"], RESIZE_HANDLES[index % 4], index % 9 + 3, index % 7 + 3, index % 2 === 0);
    const after = history.getSnapshot(1);
    history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
    history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
    history.undo();
  }
  assert.deepEqual(history.getSnapshot(1).elements, original.elements);
});

test("tiny and edge selections retain four non-overlapping, fully visible resize targets", () => {
  const viewport = { width: 800, height: 600 };
  for (const bounds of [
    { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 },
    { minX: 799.5, minY: 599.5, maxX: 800, maxY: 600 },
    { minX: 50, minY: 40, maxX: 500, maxY: 40.5 },
    { minX: -100, minY: -100, maxX: 900, maxY: 700 },
    { minX: 400, minY: 200, maxX: 400.5, maxY: 200.5 },
  ]) {
    const frame = resizeHandleDisplayBounds(bounds, viewport);
    const positions = RESIZE_HANDLES.map(handle => resizeHandlePoint(frame, handle));
    for (const point of positions) {
      assert.ok(point.x >= RESIZE_HANDLE_SIZE / 2 && point.x <= viewport.width - RESIZE_HANDLE_SIZE / 2);
      assert.ok(point.y >= RESIZE_HANDLE_SIZE / 2 && point.y <= viewport.height - RESIZE_HANDLE_SIZE / 2);
    }
    assert.ok(frame.maxX - frame.minX >= RESIZE_HANDLE_SIZE);
    assert.ok(frame.maxY - frame.minY >= RESIZE_HANDLE_SIZE);
    const identity = selectionResizeTransform(bounds, 'se', 0, 0, false);
    assert.equal(identity.scaleX, 1); assert.equal(identity.scaleY, 1);
  }
});

test("resize target layout is independent of DPR and leaves the geometry pivot unchanged", () => {
  const frame = resizeHandleDisplayBounds(box, { width: 800, height: 600 });
  assert.deepEqual(frame, { minX: 6, minY: 12, maxX: 122, maxY: 78 });
  const transform = selectionResizeTransform(box, 'se', 20, 10, false);
  assert.deepEqual(transform.anchor, { x: 10, y: 20 });
  assert.throws(() => resizeHandleDisplayBounds(box, { width: 0, height: 600 }));
});
