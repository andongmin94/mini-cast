import { shapeControlPoints, textControlPoints } from "../../../dist/annotation/primitive-frame.js";
import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, MAX_ANNOTATION_COORDINATE, translateAnnotationElement } from "../../../dist/annotation/history.js";
import { createAnnotationUpdate, reduceAnnotationUpdate, AnnotationReplica } from "../../../dist/annotation/document-sync.js";
import {
  applyAnnotationSelectionEdit, readAnnotationSelectionEdit, hitTestAnnotationSelection,
  selectionAfterClick, annotationSelectionBounds, translateSelectionElements,
} from "../../../dist/annotation/selection.js";

const line = (id, x = 10) => ({ id, tool: "line", color: "#FF0000", opacity: 1, width: 4,
  points: [{ x, y: 20 }, { x: x + 40, y: 20 }] });
const text = { id: "text", tool: "text", color: "#123456", opacity: 1,
  points: textControlPoints({ x: 30, y: 80 }), text: "한글\ntext", fontSize: 28,
  box: { minX: -2, minY: -22, maxX: 70, maxY: 34 } };
function setup() {
  const history = new AnnotationHistory();
  history.setDisplayViewport(1, 800, 600);
  history.addElement(1, line("a"));
  history.addElement(1, line("b", 90));
  history.addElement(1, text);
  return history;
}
function edit(history, kind, ids, dx = 0, dy = 0, displayId = 1) {
  return applyAnnotationSelectionEdit(history, displayId,
    { kind, ids, dx, dy, revision: history.getSnapshot(displayId).revision });
}
function rejectsWithoutMutation(history, operation, reason) {
  const before = history.getSnapshot(1);
  const canUndo = history.canUndo, canRedo = history.canRedo;
  assert.throws(operation, error => error.reason === reason);
  assert.strictEqual(history.getSnapshot(1), before);
  assert.equal(history.canUndo, canUndo);
  assert.equal(history.canRedo, canRedo);
}

test("selection hit testing chooses the last visible object and includes stroke width", () => {
  assert.equal(hitTestAnnotationSelection([line("bottom"), line("top")], { x: 20, y: 21 }), "top");
  assert.equal(hitTestAnnotationSelection([line("a")], { x: 20, y: 27 }, 6), "a");
  assert.equal(hitTestAnnotationSelection([line("a")], { x: 20, y: 29 }, 6), null);
  assert.equal(hitTestAnnotationSelection([line("a")], { x: NaN, y: 20 }), null);
});

test("selection does not hit empty shape interiors and does hit text layout areas", () => {
  for (const tool of ["rectangle", "ellipse"]) {
    const shape = { ...line(tool), tool, points: shapeControlPoints(tool, { x: 0, y: 0 }, { x: 200, y: 100 }) };
    assert.equal(hitTestAnnotationSelection([shape], { x: 100, y: 50 }), null);
    assert.equal(hitTestAnnotationSelection([shape], { x: 200, y: 50 }), tool);
  }
  assert.equal(hitTestAnnotationSelection([text], { x: 60, y: 80 }), "text");
});

test("plain clicks preserve a selected group and Shift only toggles the hit object", () => {
  assert.deepEqual(selectionAfterClick(["a", "b"], "a", false), ["a", "b"]);
  assert.deepEqual(selectionAfterClick(["a", "b"], "c", false), ["c"]);
  assert.deepEqual(selectionAfterClick(["a", "b"], "a", true), ["b"]);
  assert.deepEqual(selectionAfterClick(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(selectionAfterClick(["a"], null, true), ["a"]);
  assert.deepEqual(selectionAfterClick(["a"], null, false), []);
});

test("selection bounds include glyph overhang and return null for absent ids", () => {
  assert.deepEqual(annotationSelectionBounds([text], new Set(["text"])),
    { minX: 28, minY: 58, maxX: 100, maxY: 114 });
  assert.equal(annotationSelectionBounds([text], new Set(["missing"])), null);
});

test("a group move retains object identity, styles, stacking order, and untouched geometry", () => {
  const history = setup();
  const before = history.getSnapshot(1);
  edit(history, "move", ["a", "text"], 13, -7);
  const after = history.getSnapshot(1);
  assert.deepEqual(after.elements.map(e => e.id), ["a", "b", "text"]);
  assert.strictEqual(after.elements[1], before.elements[1]);
  assert.deepEqual(after.elements[0].points, [{ x: 23, y: 13 }, { x: 63, y: 13 }]);
  assert.deepEqual(after.elements[2], { ...before.elements[2], points: textControlPoints({ x: 43, y: 73 }) });
  assert.ok(Object.isFrozen(after.elements[0]));
  assert.ok(Object.isFrozen(after.elements[0].points[0]));
  history.undo();
  assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  history.redo();
  assert.deepEqual(history.getSnapshot(1).elements, after.elements);
});

test("preview translation and committed translation are identical for every tool", () => {
  for (const tool of ["pen", "highlighter", "line", "arrow", "rectangle", "ellipse", "text"]) {
    const element = tool === "text" ? text : { ...line(tool), tool, points: shapeControlPoints(tool, {x:10,y:20}, {x:50,y:80}), opacity: tool === "highlighter" ? 0.35 : 1 };
    const history = new AnnotationHistory(); history.addElement(1, element);
    const source = history.getSnapshot(1).elements;
    const preview = translateSelectionElements(source, new Set([element.id]), -3.5, 9.25);
    edit(history, "move", [element.id], -3.5, 9.25);
    assert.deepEqual(history.getSnapshot(1).elements, preview);
    assert.deepEqual(source[0], element);
  }
});

test("zero displacement neither creates history nor invalidates the snapshot or Redo", () => {
  const history = setup(); history.undo();
  const before = history.getSnapshot(1);
  assert.equal(edit(history, "move", ["a"], 0, 0), null);
  assert.strictEqual(history.getSnapshot(1), before);
  assert.equal(history.canRedo, true);
  assert.strictEqual(translateSelectionElements(before.elements, new Set(["a"]), 0, 0), before.elements);
});

test("stale selection revisions and absent ids are rejected atomically", () => {
  const history = setup(); const revision = history.getSnapshot(1).revision;
  history.addElement(1, line("new"));
  for (const kind of ["move", "delete"]) {
    rejectsWithoutMutation(history, () => applyAnnotationSelectionEdit(history, 1,
      { kind, ids: ["a"], revision, dx: 5, dy: 5 }), "stale-document");
    rejectsWithoutMutation(history, () => edit(history, kind, ["a", "missing"], 5, 5), "stale-document");
  }
});

test("one invalid translated point rejects the whole group before any edit", () => {
  const history = setup();
  history.addElement(1, { ...line("edge"), points: [{ x: MAX_ANNOTATION_COORDINATE, y: 20 }] , tool: "pen" });
  rejectsWithoutMutation(history, () => edit(history, "move", ["a", "edge"], 1, 0), "invalid-element");
  for (const dx of [NaN, Infinity, -Infinity]) {
    rejectsWithoutMutation(history, () => history.translateElements(1, ["a"], dx, 1), "invalid-element");
  }
});

test("selection payload rejects duplicate ids, oversized offsets, and malformed revisions", () => {
  const valid = { kind: "move", revision: 3, ids: ["a"], dx: 1, dy: 2 };
  assert.deepEqual(readAnnotationSelectionEdit(valid), valid);
  for (const value of [null, [], { ...valid, ids: [] }, { ...valid, ids: ["a", "a"] },
    { ...valid, revision: -1 }, { ...valid, revision: 1.5 }, { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, dx: NaN }, { ...valid, dy: Infinity }, { ...valid, dx: 3 * MAX_ANNOTATION_COORDINATE },
    { ...valid, kind: "replace" }]) assert.equal(readAnnotationSelectionEdit(value), null);
});

test("a new move clears Redo and global Undo ordering still spans multiple displays", () => {
  const history = setup(); history.addElement(2, line("other"));
  assert.equal(edit(history, "move", ["a"], 5, 7), 1);
  assert.equal(history.undo(), 1);
  assert.equal(history.undo(), 2);
  edit(history, "move", ["a"], 1, 1);
  assert.equal(history.canRedo, false);
});

test("selection deletion is one undoable operation with exact order restoration", () => {
  const history = setup(); const before = history.getSnapshot(1);
  edit(history, "delete", ["a", "text"]);
  assert.deepEqual(history.getSnapshot(1).elements.map(e => e.id), ["b"]);
  history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements.map(e => e.id), ["b"]);
});

test("move history and checkpoints follow nonuniform viewport changes", () => {
  const history = setup(); const before = history.getSnapshot(1);
  edit(history, "move", ["a", "text"], 15, 25);
  const checkpoint = history.clone();
  history.setDisplayViewport(1, 1600, 300);
  const scaled = history.getSnapshot(1);
  history.undo();
  assert.deepEqual(history.getSnapshot(1).elements[0].points, before.elements[0].points.map(p => ({ x: p.x * 2, y: p.y / 2 })));
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, scaled.elements);
  history.restoreFrom(checkpoint);
  assert.deepEqual(history.getSnapshot(1).elements, checkpoint.getSnapshot(1).elements);
  history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
});

test("move delta only carries changed geometry and does not lose text metadata", () => {
  const history = setup(); const before = history.getSnapshot(1);
  edit(history, "move", ["text"], 20, -10); const after = history.getSnapshot(1);
  const delta = createAnnotationUpdate(before, after);
  assert.equal(delta.kind, "delta"); assert.deepEqual(delta.removedIds, ["text"]);
  assert.equal(delta.inserted.length, 1); assert.equal(delta.inserted[0].index, 2);
  const reduced = reduceAnnotationUpdate(before, 1, delta);
  assert.equal(reduced.kind, "adopt"); assert.deepEqual(reduced.document, after);
});

test("late move acknowledgement after Undo converges to the newest document", async () => {
  const history = setup(); const before = history.getSnapshot(1);
  const replica = new AnnotationReplica(async () => history.getSnapshot(1), () => {});
  replica.reset(1); await replica.receive({ kind: "snapshot", document: before });
  edit(history, "move", ["a", "text"], 15, 25); const moved = history.getSnapshot(1);
  const reply = createAnnotationUpdate(before, moved);
  history.undo(); const undone = history.getSnapshot(1);
  await replica.receive(createAnnotationUpdate(moved, undone));
  await replica.receive(reply);
  assert.deepEqual(replica.document, undone);
});

test("retained snapshots never change across 1000 group translations and Undo/Redo", () => {
  const history = setup(); const original = history.getSnapshot(1);
  for (let index = 0; index < 1000; index += 1) {
    const before = history.getSnapshot(1);
    const ids = index % 2 ? ["a", "text"] : ["b"];
    const dx = index % 7 - 3, dy = index % 5 - 2;
    if (!dx && !dy) continue;
    edit(history, "move", ids, dx, dy);
    const after = history.getSnapshot(1);
    assert.deepEqual(after.elements, before.elements.map(e => ids.includes(e.id)
      ? { ...e, points: e.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : e));
    history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
    history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
  }
  assert.deepEqual(original.elements, [line("a"), line("b", 90), text]);
});

test("direct translation is immutable and detects coordinate overflow", () => {
  const source = line("a"); const result = translateAnnotationElement(source, 1, 2);
  source.points[0].x = 999;
  assert.equal(result.points[0].x, 11);
  assert.throws(() => translateAnnotationElement(line("a"), MAX_ANNOTATION_COORDINATE, 0));
});
