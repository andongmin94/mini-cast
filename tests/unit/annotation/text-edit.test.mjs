import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, replaceAnnotationText, annotationElementCost, MAX_ANNOTATION_POINTS_PER_DISPLAY } from "../../../dist/annotation/history.js";
import { AnnotationTextEditSessions } from "../../../dist/annotation/text-edit.js";
import { textControlPoints } from "../../../dist/annotation/primitive-frame.js";
import { AnnotationReplica, createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const box = { minX: -1, minY: 0, maxX: 120, maxY: 40 };
const text = (id = "text", value = "기존 제목") => ({ id, tool: "text", text: value, fontSize: 28,
  color: "#123456", opacity: 1, points: textControlPoints({ x: 100, y: 100 }), box: { ...box } });
const revision = (value = "수정한 제목\n둘째 줄", fontSize = 30) => ({ text: value, fontSize,
  box: { minX: -2, minY: 0, maxX: 190, maxY: 90 } });
function setup() {
  const history = new AnnotationHistory(); history.setDisplayViewport(1, 800, 600);
  history.addElement(1, text());
  history.addElement(1, { id: "ink", tool: "pen", width: 4, color: "#FF0000", opacity: 1, points: [{ x: 20, y: 20 }] });
  return history;
}
function rejected(history, fn, reason) {
  const before = history.getSnapshot(1), undo = history.canUndo, redo = history.canRedo;
  assert.throws(fn, error => error.reason === reason);
  assert.strictEqual(history.getSnapshot(1), before);
  assert.equal(history.canUndo, undo); assert.equal(history.canRedo, redo);
}

test("text replacement preserves ID, style, order and the full rotated/sheared frame", () => {
  const history = setup();
  history.rotateElements(1, ["text"], { x: 100, y: 100 }, Math.PI / 6);
  history.resizeElements(1, ["text"], { x: 100, y: 100 }, 1.6, 0.7);
  const before = history.getSnapshot(1);
  history.editText(1, "text", revision());
  const after = history.getSnapshot(1);
  assert.deepEqual(after.elements[0].points, before.elements[0].points);
  assert.equal(after.elements[0].text, revision().text);
  assert.equal(after.elements[0].fontSize, 30);
  assert.equal(after.elements[0].color, before.elements[0].color);
  assert.equal(after.elements[0].id, "text");
  assert.strictEqual(after.elements[1], before.elements[1]);
  assert.equal(after.revision, before.revision + 1);
  history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
});

test("identical content and size preserve snapshot identity, history and Redo", () => {
  const history = setup(); history.undo(); const before = history.getSnapshot(1);
  const element = before.elements[0];
  assert.equal(history.editText(1, "text", { text: element.text, fontSize: element.fontSize, box }), null);
  assert.strictEqual(history.getSnapshot(1), before); assert.equal(history.canRedo, true);
});

test("text edits reject empty content, malformed metrics and non-text targets before mutation", () => {
  const history = setup();
  for (const value of [null, {}, revision(" "), revision("x", 97), revision("x\u0000"),
    revision("x".repeat(2001)), revision(Array(21).fill("x").join("\n")),
    { ...revision(), box: { ...box, maxX: Infinity } }, { ...revision(), box: { ...box, maxX: -2 } }])
    rejected(history, () => history.editText(1, "text", value), "invalid-element");
  rejected(history, () => history.editText(1, "ink", revision()), "invalid-element");
  rejected(history, () => history.editText(1, "missing", revision()), "stale-document");
});

test("new text metrics cannot overflow the existing affine frame", () => {
  const history = setup();
  history.resizeElements(1, ["text"], { x: 100, y: 100 }, 1000, 1000);
  rejected(history, () => history.editText(1, "text", { ...revision(), box: { ...box, maxX: 2000 } }), "invalid-element");
});

test("untrusted replacement metadata cannot move, recolor or re-identify existing text", () => {
  const source = text(); const input = { ...revision(), id: "attacker", color: "#000000", points: [{ x: 9, y: 9 }] };
  const next = replaceAnnotationText(source, input);
  assert.deepEqual(next.points, source.points); assert.equal(next.id, source.id); assert.equal(next.color, source.color);
  input.box.maxX = 1234; source.points[0].x = 999;
  assert.equal(next.box.maxX, 190); assert.equal(next.points[0].x, 100);
  assert.ok(Object.isFrozen(next)); assert.ok(Object.isFrozen(next.box)); assert.ok(Object.isFrozen(next.points[0]));
});

test("replacement cost is checked atomically and restored by Undo/Redo", () => {
  const history = new AnnotationHistory(); history.addElement(1, text("text", "ABCDE"));
  let remaining = MAX_ANNOTATION_POINTS_PER_DISPLAY - annotationElementCost(history.getSnapshot(1).elements[0]);
  let index = 0;
  while (remaining) {
    const length = Math.min(50000, remaining);
    history.addElement(1, { id: "bulk" + index++, tool: "pen", width: 1, color: "#000000", opacity: 1,
      points: Array.from({ length }, () => ({ x: 1, y: 1 })) });
    remaining -= length;
  }
  rejected(history, () => history.editText(1, "text", revision("ABCDEF")), "point-limit");
  history.editText(1, "text", revision("ABCD"));
  history.addElement(1, { id: "extra", tool: "pen", width: 1, color: "#000000", opacity: 1, points: [{ x: 2, y: 2 }] });
  history.undo(); history.undo();
  assert.equal(history.getSnapshot(1).elements[0].text, "ABCDE");
  rejected(history, () => history.editText(1, "text", revision("ABCDEF")), "point-limit");
  history.redo(); history.redo();
  assert.equal(history.getSnapshot(1).elements.at(-1).id, "extra");
});

test("editing participates in global chronological history and viewport rebasing", () => {
  const history = setup(); history.addElement(2, text("other"));
  const before = history.getSnapshot(1);
  history.editText(1, "text", revision()); const checkpoint = history.clone();
  history.setDisplayViewport(1, 1600, 300); const rebased = history.getSnapshot(1);
  assert.equal(history.undo(), 1);
  assert.equal(history.getSnapshot(1).elements[0].text, before.elements[0].text);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, rebased.elements);
  history.restoreFrom(checkpoint); history.undo();
  assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  assert.equal(history.undo(), 2);
});

test("replacement deltas carry only the changed text and survive reversed acknowledgements", async () => {
  const history = setup(); const before = history.getSnapshot(1);
  const replica = new AnnotationReplica(async () => history.getSnapshot(1), () => {});
  replica.reset(1); await replica.receive({ kind: "snapshot", document: before });
  history.editText(1, "text", revision()); const edited = history.getSnapshot(1);
  const delta = createAnnotationUpdate(before, edited);
  assert.equal(delta.kind, "delta"); assert.deepEqual(delta.removedIds, ["text"]); assert.equal(delta.inserted.length, 1);
  assert.deepEqual(reduceAnnotationUpdate(before, 1, delta).document, edited);
  history.undo(); const undone = history.getSnapshot(1);
  await replica.receive(createAnnotationUpdate(edited, undone)); await replica.receive(delta);
  assert.deepEqual(replica.document, undone);
});

test("500 text replacements leave all retained snapshots and exact Undo values unchanged", () => {
  const history = setup(); const original = history.getSnapshot(1);
  for (let index = 0; index < 500; index++) {
    const before = history.getSnapshot(1);
    history.editText(1, "text", revision("수정 " + index, 12 + index % 85));
    const after = history.getSnapshot(1); history.undo();
    assert.deepEqual(history.getSnapshot(1).elements, before.elements);
    history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
  }
  assert.equal(original.elements[0].text, "기존 제목");
});

test("opening and cancelling an edit session do not touch document history", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history), before = history.getSnapshot(1);
  const session = sessions.open(1, before.revision, "text", "session-1");
  assert.ok(Object.isFrozen(session)); assert.equal(sessions.cancel("wrong"), false);
  assert.equal(sessions.cancel(session.id), true); assert.equal(sessions.current, null);
  assert.strictEqual(history.getSnapshot(1), before);
  rejected(history, () => sessions.save(session.id, revision()), "stale-gesture");
});

test("a session cannot be replaced or retargeted by an overlapping editor request", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  sessions.open(1, history.getSnapshot(1).revision, "text", "first");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision, "text", "second"), e => e.reason === "unavailable");
  assert.equal(sessions.current.id, "first");
  rejected(history, () => sessions.save("second", revision()), "stale-gesture");
  sessions.save("first", revision()); assert.equal(sessions.current, null);
  rejected(history, () => sessions.save("first", revision()), "stale-gesture");
});

test("stale source revision rejects the complete save without losing the editor session", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  const session = sessions.open(1, history.getSnapshot(1).revision, "text", "first");
  history.translateElements(1, ["text"], 1, 1);
  rejected(history, () => sessions.save(session.id, revision()), "stale-document");
  assert.strictEqual(sessions.current, session);
});

test("invalid text remains retryable and a no-op save closes only its own session", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history), before = history.getSnapshot(1);
  const session = sessions.open(1, before.revision, "text", "first");
  rejected(history, () => sessions.save(session.id, revision(" ")), "invalid-element");
  assert.strictEqual(sessions.current, session);
  assert.deepEqual(sessions.save(session.id, { text: session.element.text, fontSize: 28, box }), { displayId: 1, changed: false });
  assert.strictEqual(history.getSnapshot(1), before); assert.equal(sessions.current, null);
});

test("session opening validates revision and the exact target type", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  for (const bad of [-1, 0.5, Infinity, NaN])
    assert.throws(() => sessions.open(1, bad, "text", "first"), e => e.reason === "invalid-element");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision - 1, "text", "first"), e => e.reason === "stale-document");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision, "ink", "first"), e => e.reason === "invalid-element");
  assert.equal(sessions.current, null);
});
