import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationError, annotationFailureMessage } from "../../../dist/annotation/errors.js";
import { AnnotationHistory, MAX_ANNOTATION_ELEMENTS_PER_DISPLAY } from "../../../dist/annotation/history.js";

const stroke = (id) => ({ id, tool: "pen", points: [{ x: 1, y: 1 }], color: "#000000", width: 4, opacity: 1 });

test("annotation failures carry stable domain reasons", () => {
  const history = new AnnotationHistory();
  assert.throws(() => history.addElement(1, { ...stroke("bad"), width: -1 }), (error) => error instanceof AnnotationError && error.reason === "invalid-element");
  history.addElement(1, stroke("a"));
  assert.throws(() => history.addElement(1, stroke("a")), (error) => error instanceof AnnotationError && error.reason === "duplicate-element");
  assert.equal(history.getSnapshot(1).elements.length, 1);
});

test("a rejected capacity mutation leaves the document and history unchanged", () => {
  const history = new AnnotationHistory();
  for (let index = 0;index < MAX_ANNOTATION_ELEMENTS_PER_DISPLAY;index += 1) history.addElement(1, stroke(String(index)));
  const before = history.getSnapshot(1);
  assert.throws(() => history.addElement(1, stroke("overflow")), (error) => error instanceof AnnotationError && error.reason === "element-limit");
  assert.deepEqual(history.getSnapshot(1), before);
  assert.equal(history.undo(), 1);
  assert.equal(history.getSnapshot(1).elements.length, MAX_ANNOTATION_ELEMENTS_PER_DISPLAY - 1);
});

test("capacity and transport conditions are not presented as silent cancellation", () => {
  for (const reason of ["point-limit", "element-limit", "unavailable", "internal", "invalid-element", "duplicate-element"]) assert.ok(annotationFailureMessage(reason));
  assert.equal(annotationFailureMessage("stale-gesture"), null);
  assert.equal(annotationFailureMessage("no-change"), null);
});
