import assert from "node:assert/strict";
import test from "node:test";

import {
  AnnotationHistory,
  isAnnotationStroke,
  readAnnotationStrokeIds,
} from "../dist/annotation/history.js";

function stroke(id) {
  return {
    id,
    tool: "pen",
    points: [{ x: 1, y: 2 }],
    color: "#000000",
    width: 4,
    opacity: 1,
  };
}

function ids(history, displayId) {
  return history.getSnapshot(displayId).strokes.map((item) => item.id);
}

test("global undo and redo follow chronological order across displays", () => {
  const history = new AnnotationHistory();
  history.addStroke(10, stroke("a"));
  history.addStroke(20, stroke("b"));

  assert.deepEqual(ids(history, 10), ["a"]);
  assert.deepEqual(ids(history, 20), ["b"]);
  assert.equal(history.undo(), 20);
  assert.deepEqual(ids(history, 20), []);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), []);
  assert.equal(history.redo(), 10);
  assert.deepEqual(ids(history, 10), ["a"]);
  assert.equal(history.redo(), 20);
  assert.deepEqual(ids(history, 20), ["b"]);
});

test("one erase gesture restores every removed stroke in place", () => {
  const history = new AnnotationHistory();
  history.addStroke(10, stroke("a"));
  history.addStroke(10, stroke("b"));
  history.addStroke(10, stroke("c"));

  assert.equal(history.removeStrokes(10, ["a", "c"]), 10);
  assert.deepEqual(ids(history, 10), ["b"]);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a", "b", "c"]);
  assert.equal(history.redo(), 10);
  assert.deepEqual(ids(history, 10), ["b"]);
});

test("clear is scoped to one display and remains undoable", () => {
  const history = new AnnotationHistory();
  history.addStroke(10, stroke("a"));
  history.addStroke(20, stroke("b"));

  assert.equal(history.clearDisplay(10), 10);
  assert.deepEqual(ids(history, 10), []);
  assert.deepEqual(ids(history, 20), ["b"]);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a"]);
});

test("new edits drop redo history and revisions advance", () => {
  const history = new AnnotationHistory();
  history.addStroke(10, stroke("a"));
  const firstRevision = history.getSnapshot(10).revision;
  assert.equal(history.undo(), 10);
  history.addStroke(10, stroke("b"));

  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), null);
  assert.deepEqual(ids(history, 10), ["b"]);
  assert.ok(history.getSnapshot(10).revision > firstRevision);
});

test("runtime stroke and id validation rejects malformed payloads", () => {
  assert.equal(isAnnotationStroke(stroke("a")), true);
  assert.equal(isAnnotationStroke({ ...stroke("a"), width: Infinity }), false);
  assert.equal(isAnnotationStroke({ ...stroke("a"), points: [{ x: NaN, y: 0 }] }), false);
  assert.deepEqual(readAnnotationStrokeIds(["a", "a", "b"]), ["a", "b"]);
  assert.equal(readAnnotationStrokeIds(["", "b"]), null);
});
