import assert from "node:assert/strict";
import test from "node:test";

import {
  AnnotationHistory,
  isAnnotationStroke,
  readAnnotationStrokeIds,
} from "../dist/annotation/history.js";

function stroke(id, x = 1, y = 2, width = 4) {
  return {
    id,
    tool: "pen",
    points: [{ x, y }],
    color: "#000000",
    width,
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

test("viewport changes rescale documents and both history stacks", () => {
  const history = new AnnotationHistory();
  history.setDisplayViewport(10, 100, 100);
  history.addStroke(10, stroke("a", 25, 50, 4));
  history.addStroke(10, stroke("b", 50, 25, 8));
  assert.equal(history.undo(), 10);

  history.setDisplayViewport(10, 200, 50);
  let snapshot = history.getSnapshot(10);
  assert.deepEqual(snapshot.viewport, { width: 200, height: 50 });
  assert.deepEqual(snapshot.strokes[0].points[0], { x: 50, y: 25 });
  assert.equal(snapshot.strokes[0].width, 4);

  assert.equal(history.redo(), 10);
  snapshot = history.getSnapshot(10);
  assert.deepEqual(snapshot.strokes[1].points[0], { x: 100, y: 12.5 });
  assert.equal(snapshot.strokes[1].width, 8);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a"]);
});

test("snapshots and input objects cannot mutate stored history", () => {
  const history = new AnnotationHistory();
  const source = stroke("a", 10, 20);
  history.addStroke(10, source);
  source.points[0].x = 999;

  const snapshot = history.getSnapshot(10);
  snapshot.strokes[0].points[0].x = 777;
  assert.deepEqual(history.getSnapshot(10).strokes[0].points[0], {
    x: 10,
    y: 20,
  });
});

test("runtime stroke and id validation rejects malformed payloads", () => {
  assert.equal(isAnnotationStroke(stroke("a")), true);
  assert.equal(isAnnotationStroke({ ...stroke("a"), width: Infinity }), false);
  assert.equal(
    isAnnotationStroke({ ...stroke("a"), points: [{ x: NaN, y: 0 }] }),
    false,
  );
  assert.deepEqual(readAnnotationStrokeIds(["a", "a", "b"]), ["a", "b"]);
  assert.equal(readAnnotationStrokeIds(["", "b"]), null);
});

test("history checkpoints restore documents, revisions, and both stacks", () => {
  const history = new AnnotationHistory();
  history.setDisplayViewport(10, 100, 100);
  history.addStroke(10, stroke("a", 25, 50, 4));
  history.addStroke(10, stroke("b", 50, 25, 8));
  assert.equal(history.undo(), 10);

  const checkpoint = history.clone();
  const expected = history.getSnapshot(10);

  history.setDisplayViewport(10, 200, 50);
  history.addStroke(10, stroke("c", 100, 25, 6));
  history.restoreFrom(checkpoint);

  assert.deepEqual(history.getSnapshot(10), expected);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), 10);
  assert.deepEqual(ids(history, 10), ["a", "b"]);
  assert.deepEqual(history.getSnapshot(10).strokes[1].points[0], {
    x: 50,
    y: 25,
  });

  checkpoint.addStroke(10, stroke("checkpoint-only", 10, 10, 2));
  assert.deepEqual(ids(history, 10), ["a", "b"]);
});

test("large append histories preserve ids and chronological undo/redo", () => {
  const history = new AnnotationHistory();
  const total = 5_000;
  for (let index = 0; index < total; index += 1) {
    history.addStroke(1, stroke(`large-${index}`, index, index));
  }
  assert.equal(history.getSnapshot(1).strokes.length, total);

  for (let index = 0; index < 1_000; index += 1) history.undo();
  assert.equal(history.getSnapshot(1).strokes.length, total - 1_000);

  for (let index = 0; index < 1_000; index += 1) history.redo();
  const snapshot = history.getSnapshot(1);
  assert.equal(snapshot.strokes.length, total);
  assert.equal(snapshot.strokes[0].id, "large-0");
  assert.equal(snapshot.strokes[total - 1].id, `large-${total - 1}`);
});

test("stroke id index stays consistent across remove and undo/redo", () => {
  const history = new AnnotationHistory();
  history.addStroke(1, stroke("stable-id"));
  assert.throws(
    () => history.addStroke(1, stroke("stable-id")),
    /Duplicate annotation stroke id/,
  );

  history.removeStrokes(1, ["stable-id"]);
  history.addStroke(1, stroke("stable-id", 3, 4));
  assert.equal(history.getSnapshot(1).strokes.length, 1);

  history.undo();
  history.undo();
  assert.equal(history.getSnapshot(1).strokes[0].id, "stable-id");
  assert.throws(
    () => history.addStroke(1, stroke("stable-id")),
    /Duplicate annotation stroke id/,
  );

  history.redo();
  history.redo();
  assert.equal(history.getSnapshot(1).strokes[0].id, "stable-id");
  assert.throws(
    () => history.addStroke(1, stroke("stable-id")),
    /Duplicate annotation stroke id/,
  );
});
