import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory } from "../../../dist/annotation/history.js";
import { AnnotationSaveState } from "../../../dist/electron/annotation-save-state.js";

function fixture() {
  const history = new AnnotationHistory(), saved = new AnnotationSaveState();
  history.setDisplayViewport(1, 800, 600); history.setDisplayViewport(2, 800, 600);
  const point = id => ({ id, tool: "pen", color: "#123456", width: 4, opacity: 1, points: [{ x: 20, y: 30 }] });
  return { history, saved, point, snapshot: (id = 1) => history.getSnapshot(id) };
}
test("empty new documents and background-only presentation state are clean", () => {
  const { saved, snapshot } = fixture();
  assert.equal(saved.isDirty(snapshot()), false); assert.equal(saved.key([snapshot(), snapshot(2)]), null);
});
test("a saved fingerprint becomes dirty on edit and clean again on exact Undo regardless of revision", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("first"));
  assert.equal(saved.isDirty(snapshot()), true); saved.markSaved(snapshot());
  const originalRevision = snapshot().revision;
  history.addElement(1, point("second")); assert.equal(saved.isDirty(snapshot()), true);
  history.undo(); assert.ok(snapshot().revision > originalRevision); assert.equal(saved.isDirty(snapshot()), false);
  history.redo(); assert.equal(saved.isDirty(snapshot()), true);
});
test("saving an older pinned snapshot never marks concurrent edits as saved", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("before")); const pinned = snapshot();
  history.addElement(1, point("after")); saved.markSaved(pinned);
  assert.equal(saved.isDirty(snapshot()), true); history.undo(); assert.equal(saved.isDirty(snapshot()), false);
});
test("loaded files can establish a clean baseline without resetting Undo", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("old"));
  history.replaceDocumentElements(1, [point("loaded")], snapshot().revision); saved.markSaved(snapshot());
  assert.equal(saved.isDirty(snapshot()), false); history.undo(); assert.equal(saved.isDirty(snapshot()), true);
  history.redo(); assert.equal(saved.isDirty(snapshot()), false);
});
test("deleting saved contents is dirty, but clearing never-saved contents back to blank is clean", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("first")); history.clearDisplay(1);
  assert.equal(saved.isDirty(snapshot()), false); history.undo(); saved.markSaved(snapshot()); history.clearDisplay(1);
  assert.equal(saved.isDirty(snapshot()), true);
});
test("JSON property ordering and history metadata do not change a content fingerprint", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("first")); saved.markSaved(snapshot());
  const original = snapshot(), element = original.elements[0];
  const equivalent = { ...original, revision: 999, elements: [{ points: [{ y: 30, x: 20 }], opacity: 1,
    width: 4, color: element.color, tool: "pen", id: element.id }] };
  assert.equal(saved.isDirty(equivalent), false);
});
test("all persisted geometry, styles, text, frames, fills and stacking order affect save state", () => {
  const { history, saved, point, snapshot } = fixture();
  const text = { id: "text", tool: "text", text: "한글", fontSize: 20, opacity: 1, color: "#000000",
    box: { minX: 0, minY: 0, maxX: 80, maxY: 30 }, points: [{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 100, y: 101 }] };
  const box = { id: "box", tool: "rectangle", width: 4, color: "#000000", fill: "#FFFFFF", opacity: 1,
    points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 10, y: 60 }] };
  for (const element of [point("first"), text, box]) history.addElement(1, element);
  const base = snapshot(); saved.markSaved(base);
  for (const change of [e => { e[0].points[0].x++; }, e => { e[0].width++; }, e => { e[0].color = "#FF0000"; },
    e => { e[0].opacity = 0.5; }, e => { e[1].text += " 수정"; }, e => { e[1].fontSize++; },
    e => { e[1].box.maxX++; }, e => { e[1].points[1].y++; }, e => { e[2].fill = "#123456"; }, e => { e.reverse(); }]) {
    const elements = structuredClone(base.elements); change(elements); assert.equal(saved.isDirty({ ...base, elements }), true);
  }
});
test("discard keys cover every dirty monitor independent of monitor enumeration order", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("one")); history.addElement(2, point("two"));
  const key = saved.key([snapshot(), snapshot(2)]); assert.equal(key, saved.key([snapshot(2), snapshot()]));
  saved.markSaved(snapshot()); assert.notEqual(saved.key([snapshot(), snapshot(2)]), key);
  saved.markSaved(snapshot(2)); assert.equal(saved.key([snapshot(), snapshot(2)]), null);
});
test("disconnected monitors release old save baselines and viewport changes are not silently saved", () => {
  const { history, saved, point, snapshot } = fixture(); history.addElement(1, point("saved")); saved.markSaved(snapshot());
  history.setDisplayViewport(1, 1000, 600); assert.equal(saved.isDirty(snapshot()), true);
  saved.retainDisplays([2]); history.clearDisplay(1); assert.equal(saved.isDirty(snapshot()), false);
});
