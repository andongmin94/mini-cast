import assert from "node:assert/strict";
import test from "node:test";

import {
  AnnotationHistory,
  isAnnotationElement,
  MAX_ANNOTATION_COORDINATE,
  MAX_ANNOTATION_HISTORY_ENTRIES,
  MAX_ANNOTATION_HISTORY_POINTS,
  MAX_ANNOTATION_POINTS_PER_DISPLAY,
  MAX_ANNOTATION_POINTS_PER_STROKE,
  readAnnotationElementIds,
} from "../../../dist/annotation/history.js";

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
  return history.getSnapshot(displayId).elements.map((item) => item.id);
}

test("global undo and redo follow chronological order across displays", () => {
  const history = new AnnotationHistory();
  history.addElement(10, stroke("a"));
  history.addElement(20, stroke("b"));

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
  history.addElement(10, stroke("a"));
  history.addElement(10, stroke("b"));
  history.addElement(10, stroke("c"));

  assert.equal(history.removeElements(10, ["a", "c"]), 10);
  assert.deepEqual(ids(history, 10), ["b"]);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a", "b", "c"]);
  assert.equal(history.redo(), 10);
  assert.deepEqual(ids(history, 10), ["b"]);
});

test("clear is scoped to one display and remains undoable", () => {
  const history = new AnnotationHistory();
  history.addElement(10, stroke("a"));
  history.addElement(20, stroke("b"));

  assert.equal(history.clearDisplay(10), 10);
  assert.deepEqual(ids(history, 10), []);
  assert.deepEqual(ids(history, 20), ["b"]);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a"]);
});

test("new edits drop redo history and revisions advance", () => {
  const history = new AnnotationHistory();
  history.addElement(10, stroke("a"));
  const firstRevision = history.getSnapshot(10).revision;
  assert.equal(history.undo(), 10);
  history.addElement(10, stroke("b"));

  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), null);
  assert.deepEqual(ids(history, 10), ["b"]);
  assert.ok(history.getSnapshot(10).revision > firstRevision);
});

test("viewport changes rescale documents and both history stacks", () => {
  const history = new AnnotationHistory();
  history.setDisplayViewport(10, 100, 100);
  history.addElement(10, stroke("a", 25, 50, 4));
  history.addElement(10, stroke("b", 50, 25, 8));
  assert.equal(history.undo(), 10);

  history.setDisplayViewport(10, 200, 50);
  let snapshot = history.getSnapshot(10);
  assert.deepEqual(snapshot.viewport, { width: 200, height: 50 });
  assert.deepEqual(snapshot.elements[0].points[0], { x: 50, y: 25 });
  assert.equal(snapshot.elements[0].width, 4);

  assert.equal(history.redo(), 10);
  snapshot = history.getSnapshot(10);
  assert.deepEqual(snapshot.elements[1].points[0], { x: 100, y: 12.5 });
  assert.equal(snapshot.elements[1].width, 8);
  assert.equal(history.undo(), 10);
  assert.deepEqual(ids(history, 10), ["a"]);
});

test("viewport rescaling rejects overflowing points and complete text frames", () => {
  const sources = [
    stroke("far", 600000, 100),
    { id: "text", tool: "text", color: "#000000", opacity: 1, text: "A", fontSize: 20,
      points: [{ x: 499950, y: 10 }, { x: 499951, y: 10 }, { x: 499950, y: 11 }],
      box: { minX: 0, minY: 0, maxX: 100, maxY: 20 } },
  ];
  for (const source of sources) {
    const history = new AnnotationHistory();
    history.setDisplayViewport(10, 1920, 1080);
    history.addElement(10, stroke("a", 25, 50));
    history.addElement(10, source);
    const before = history.getSnapshot(10);

    assert.throws(() => history.setDisplayViewport(10, 3840, 2160),
      error => error.reason === "invalid-element");
    assert.strictEqual(history.getSnapshot(10), before);
    assert.equal(history.undo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, [stroke("a", 25, 50)]);
    assert.deepEqual(history.getSnapshot(10).viewport, before.viewport);
    assert.equal(history.redo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, before.elements);
  }
});

for (const stack of ["Undo", "Redo"]) {
  test(`viewport rescaling rejects invalid ${stack} geometry without partial changes`, () => {
    const history = new AnnotationHistory();
    history.setDisplayViewport(10, 1920, 1080);
    const near = stroke("near", 25, 50);
    const far = stroke("far", 600000, 100);
    history.addElement(10, near);
    history.addElement(10, far);
    if (stack === "Undo") history.removeElements(10, ["far"]);
    else history.undo();
    const before = history.getSnapshot(10);
    const canUndo = history.canUndo, canRedo = history.canRedo;

    assert.throws(() => history.setDisplayViewport(10, 3840, 2160),
      error => error.reason === "invalid-element");
    assert.strictEqual(history.getSnapshot(10), before);
    assert.equal(history.canUndo, canUndo);
    assert.equal(history.canRedo, canRedo);
    assert.equal(stack === "Undo" ? history.undo() : history.redo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, [near, far]);
    assert.deepEqual(history.getSnapshot(10).viewport, before.viewport);
    assert.equal(history.undo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, [near]);
    assert.equal(history.undo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, []);
    assert.equal(history.redo(), 10);
    assert.deepEqual(history.getSnapshot(10).elements, [near]);
  });
}

test("snapshots and input objects cannot mutate stored history", () => {
  const history = new AnnotationHistory();
  const source = stroke("a", 10, 20);
  history.addElement(10, source);
  source.points[0].x = 999;

  const snapshot = history.getSnapshot(10);
  assert.throws(() => {
    snapshot.elements[0].points[0].x = 777;
  }, TypeError);
  assert.deepEqual(history.getSnapshot(10).elements[0].points[0], {
    x: 10,
    y: 20,
  });
});

test("runtime stroke and id validation rejects malformed payloads", () => {
  assert.equal(isAnnotationElement(stroke("a")), true);
  assert.equal(isAnnotationElement({ ...stroke("a"), width: Infinity }), false);
  assert.equal(
    isAnnotationElement({ ...stroke("a"), points: [{ x: NaN, y: 0 }] }),
    false,
  );
  assert.deepEqual(readAnnotationElementIds(["a", "a", "b"]), ["a", "b"]);
  assert.equal(readAnnotationElementIds(["", "b"]), null);
});

test("history enforces its runtime validation at the domain boundary", () => {
  const history = new AnnotationHistory();
  assert.throws(
    () => history.addElement(1, { ...stroke("invalid"), color: "red" }),
    /Invalid annotation element/,
  );
  assert.deepEqual(ids(history, 1), []);
});

test("runtime validation rejects pathological geometry and style payloads", () => {
  assert.equal(
    isAnnotationElement({
      ...stroke("too-far"),
      points: [{ x: MAX_ANNOTATION_COORDINATE + 1, y: 0 }],
    }),
    false,
  );
  assert.equal(
    isAnnotationElement({
      ...stroke("too-many"),
      points: Array.from(
        { length: MAX_ANNOTATION_POINTS_PER_STROKE + 1 },
        () => ({ x: 0, y: 0 }),
      ),
    }),
    false,
  );
  assert.equal(
    isAnnotationElement({ ...stroke("bad-color"), color: "red" }),
    false,
  );
  assert.equal(
    isAnnotationElement({ ...stroke("bad-opacity"), opacity: 0.5 }),
    false,
  );
});

test("document and undo limits bound long-running session memory", () => {
  const history = new AnnotationHistory();
  for (let index = 0;index < MAX_ANNOTATION_HISTORY_ENTRIES + 50;index += 1) {
    history.addElement(1, stroke(`bounded-${index}`, index, index));
  }

  for (let index = 0;index < MAX_ANNOTATION_HISTORY_ENTRIES;index += 1) {
    assert.equal(history.undo(), 1);
  }
  assert.equal(history.undo(), null);
  assert.equal(history.getSnapshot(1).elements.length, 50);

  const pointHeavy = new AnnotationHistory();
  const points = Array.from(
    { length: Math.min(MAX_ANNOTATION_POINTS_PER_STROKE, 10_000) },
    (_, index) => ({ x: index, y: 0 }),
  );
  let acceptedPoints = 0;
  let index = 0;
  while (acceptedPoints + points.length <= MAX_ANNOTATION_POINTS_PER_DISPLAY) {
    pointHeavy.addElement(1, {
      ...stroke(`points-${index}`),
      points,
    });
    acceptedPoints += points.length;
    index += 1;
  }
  assert.throws(
    () =>
      pointHeavy.addElement(1, {
        ...stroke("points-overflow"),
        points,
      }),
    /Annotation point limit reached/,
  );

  assert.equal(
    MAX_ANNOTATION_HISTORY_POINTS,
    MAX_ANNOTATION_POINTS_PER_DISPLAY,
  );
  assert.equal(pointHeavy.clearDisplay(1), 1);
  assert.equal(pointHeavy.undo(), 1);
  assert.equal(
    pointHeavy
      .getSnapshot(1)
      .elements.reduce((total, item) => total + item.points.length, 0),
    MAX_ANNOTATION_POINTS_PER_DISPLAY,
  );
  assert.equal(pointHeavy.undo(), null);
});

test("disconnected displays release documents and their undo-redo entries", () => {
  const history = new AnnotationHistory();
  history.addElement(10, stroke("kept"));
  history.addElement(20, stroke("removed"));
  assert.equal(history.undo(), 20);

  assert.equal(history.retainDisplays([10]), 1);
  assert.equal(history.canRedo, false);
  assert.deepEqual(ids(history, 10), ["kept"]);
  assert.deepEqual(ids(history, 20), []);
  assert.equal(history.undo(), 10);
  assert.equal(history.undo(), null);
});

test("history checkpoints restore documents, revisions, and both stacks", () => {
  const history = new AnnotationHistory();
  history.setDisplayViewport(10, 100, 100);
  history.addElement(10, stroke("a", 25, 50, 4));
  history.addElement(10, stroke("b", 50, 25, 8));
  assert.equal(history.undo(), 10);

  const checkpoint = history.clone();
  const expected = history.getSnapshot(10);

  history.setDisplayViewport(10, 200, 50);
  history.addElement(10, stroke("c", 100, 25, 6));
  history.restoreFrom(checkpoint);

  assert.deepEqual(history.getSnapshot(10), expected);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), 10);
  assert.deepEqual(ids(history, 10), ["a", "b"]);
  assert.deepEqual(history.getSnapshot(10).elements[1].points[0], {
    x: 50,
    y: 25,
  });

  checkpoint.addElement(10, stroke("checkpoint-only", 10, 10, 2));
  assert.deepEqual(ids(history, 10), ["a", "b"]);
});

test("large append histories preserve ids and chronological undo/redo", () => {
  const history = new AnnotationHistory();
  const total = 5_000;
  for (let index = 0;index < total;index += 1) {
    history.addElement(1, stroke(`large-${index}`, index, index));
  }
  assert.equal(history.getSnapshot(1).elements.length, total);

  for (let index = 0;index < 1_000;index += 1) history.undo();
  assert.equal(history.getSnapshot(1).elements.length, total - 1_000);

  for (let index = 0;index < 1_000;index += 1) history.redo();
  const snapshot = history.getSnapshot(1);
  assert.equal(snapshot.elements.length, total);
  assert.equal(snapshot.elements[0].id, "large-0");
  assert.equal(snapshot.elements[total - 1].id, `large-${total - 1}`);
});

test("stroke id index stays consistent across remove and undo/redo", () => {
  const history = new AnnotationHistory();
  history.addElement(1, stroke("stable-id"));
  assert.throws(
    () => history.addElement(1, stroke("stable-id")),
    /Duplicate annotation element id/,
  );

  history.removeElements(1, ["stable-id"]);
  history.addElement(1, stroke("stable-id", 3, 4));
  assert.equal(history.getSnapshot(1).elements.length, 1);

  history.undo();
  history.undo();
  assert.equal(history.getSnapshot(1).elements[0].id, "stable-id");
  assert.throws(
    () => history.addElement(1, stroke("stable-id")),
    /Duplicate annotation element id/,
  );

  history.redo();
  history.redo();
  assert.equal(history.getSnapshot(1).elements[0].id, "stable-id");
  assert.throws(
    () => history.addElement(1, stroke("stable-id")),
    /Duplicate annotation element id/,
  );
});
