import assert from "node:assert/strict";
import test from "node:test";

import { AnnotationHistory } from "../dist/annotation/history.js";

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

function ids(history) {
  return history.getSnapshot().map((item) => item.id);
}

test("add, undo, and redo preserve stroke order", () => {
  const history = new AnnotationHistory();
  history.addStroke(stroke("a"));
  history.addStroke(stroke("b"));

  assert.deepEqual(ids(history), ["a", "b"]);
  assert.equal(history.undo(), true);
  assert.deepEqual(ids(history), ["a"]);
  assert.equal(history.redo(), true);
  assert.deepEqual(ids(history), ["a", "b"]);
});

test("one erase gesture restores every removed stroke in place", () => {
  const history = new AnnotationHistory();
  history.addStroke(stroke("a"));
  history.addStroke(stroke("b"));
  history.addStroke(stroke("c"));

  assert.equal(history.removeStrokes(["a", "c"]), true);
  assert.deepEqual(ids(history), ["b"]);
  assert.equal(history.undo(), true);
  assert.deepEqual(ids(history), ["a", "b", "c"]);
  assert.equal(history.redo(), true);
  assert.deepEqual(ids(history), ["b"]);
});

test("clear is undoable and a new edit drops redo history", () => {
  const history = new AnnotationHistory();
  history.addStroke(stroke("a"));
  history.addStroke(stroke("b"));

  assert.equal(history.clear(), true);
  assert.deepEqual(ids(history), []);
  assert.equal(history.undo(), true);
  assert.deepEqual(ids(history), ["a", "b"]);

  history.addStroke(stroke("c"));
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), false);
  assert.deepEqual(ids(history), ["a", "b", "c"]);
});

test("duplicate stroke ids are rejected", () => {
  const history = new AnnotationHistory();
  history.addStroke(stroke("a"));
  assert.throws(() => history.addStroke(stroke("a")), /Duplicate/);
});
