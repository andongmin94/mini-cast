import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnotationHistory, copyAnnotationElements, MAX_ANNOTATION_ELEMENTS_PER_DISPLAY,
  MAX_ANNOTATION_POINTS_PER_DISPLAY,
} from "../../../dist/annotation/history.js";
import {
  createAnnotationFile, parseAnnotationFile, serializeAnnotationFile, fitAnnotationFile,
  readAnnotationFile, readAnnotationFileRequest, MAX_ANNOTATION_FILE_BYTES, annotationFileMessage,
} from "../../../dist/annotation/document-file.js";
import { createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const pen = (id = "pen", x = 10) => ({ id, tool: "pen", color: "#123456", width: 4, opacity: 1, points: [{ x, y: 12 }, { x: x + 10, y: 22 }] });
const fixture = () => [
  pen(),
  { ...pen("marker"), tool: "highlighter", width: 12, opacity: 0.35 },
  { ...pen("line"), tool: "line" },
  { ...pen("arrow"), tool: "arrow" },
  { ...pen("box"), tool: "rectangle", fill: "#55AA99", points: [{ x: 40, y: 12 }, { x: 60, y: 20 }, { x: 36, y: 40 }] },
  { ...pen("oval"), tool: "ellipse", points: [{ x: 50, y: 30 }, { x: 80, y: 42 }, { x: 38, y: 52 }] },
  { id: "text", tool: "text", color: "#778899", opacity: 1, text: "한글 ABC\n둘째 줄 😀", fontSize: 20,
    box: { minX: -1, minY: 0, maxX: 100, maxY: 48 }, points: [{ x: 20, y: 40 }, { x: 19.4, y: 40.8 }, { x: 20.8, y: 40.6 }] },
];
function setup(elements = fixture()) {
  const history = new AnnotationHistory(); history.setDisplayViewport(1, 200, 100);
  for (const element of elements) history.addElement(1, element);
  return history;
}
const reason = expected => error => error.reason === expected;

test("editable files round-trip every tool, Korean text, affine frames, alpha and fill exactly", () => {
  const h = setup(), snapshot = h.getSnapshot(1), file = parseAnnotationFile(serializeAnnotationFile(snapshot));
  assert.deepEqual(file.elements, snapshot.elements);
  assert.deepEqual(file.viewport, { width: 200, height: 100 });
  assert.equal(file.format, "MiniCast"); assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file).sort(), ["elements", "format", "version", "viewport"]);
  assert.ok(Object.isFrozen(file)); assert.ok(Object.isFrozen(file.elements));
  assert.ok(Object.isFrozen(file.elements[0].points[0])); assert.ok(Object.isFrozen(file.elements[6].box));
});
test("save snapshots exclude monitor IDs, revisions, Redo, transient tools and settings", () => {
  const h = setup(); h.addElement(1, pen("redo")); h.undo();
  const before = h.getSnapshot(1), text = serializeAnnotationFile(before);
  for (const key of ["displayId", "revision", "undoStack", "redoStack", "settings"]) assert.equal(text.includes(JSON.stringify(key)), false);
  assert.equal(h.getSnapshot(1), before); assert.ok(h.canRedo);
  h.addElement(1, pen("later"));
  assert.deepEqual(parseAnnotationFile(text).elements, before.elements);
});
test("blank documents remain valid editable files and BOM input is understood", () => {
  const h = setup([]), text = serializeAnnotationFile(h.getSnapshot(1));
  assert.equal(parseAnnotationFile("\uFEFF" + text).elements.length, 0);
  assert.throws(() => serializeAnnotationFile(new AnnotationHistory().getSnapshot(1)), reason("unavailable"));
});
test("only the current explicit file version is accepted", () => {
  const file = createAnnotationFile(setup().getSnapshot(1));
  for (const version of [0, 2, "1", null]) assert.throws(() => readAnnotationFile({ ...file, version }), reason("unsupported-version"));
  for (const value of [null, [], {}, { ...file, format: "other" }]) assert.throws(() => readAnnotationFile(value), reason("invalid-file"));
});
test("unknown file fields, nested metadata, executable payloads and temporary tools are rejected", () => {
  const file = JSON.parse(serializeAnnotationFile(setup().getSnapshot(1)));
  for (const value of [
    { ...file, path: "C:/secret" }, { ...file, viewport: { ...file.viewport, zoom: 2 } },
    { ...file, elements: [{ ...pen(), html: "<script>bad()</script>" }] },
    { ...file, elements: [{ ...pen(), tool: "laser" }] },
    { ...file, elements: [{ ...pen(), points: [{ x: 1, y: 2, pressure: 1 }] }] },
    { ...file, elements: [{ ...file.elements[6], box: { ...file.elements[6].box, unknown: 1 } }] },
    JSON.parse('{"__proto__":{"polluted":true},' + JSON.stringify(file).slice(1)),
  ]) assert.throws(() => readAnnotationFile(value), reason("invalid-file"));
  assert.equal({}.polluted, undefined);
});
test("malformed JSON, coordinates, colors, duplicate IDs and collection budgets are rejected", () => {
  assert.throws(() => parseAnnotationFile("{broken"), reason("invalid-file"));
  const file = createAnnotationFile(setup().getSnapshot(1));
  for (const elements of [[pen(), pen()], [{ ...pen(), color: "url(x)" }], [{ ...pen(), points: [{ x: Infinity, y: 1 }] }],
    Array(MAX_ANNOTATION_ELEMENTS_PER_DISPLAY + 1).fill(pen()), [{ ...pen(), points: [{ x: 1_000_001, y: 0 }] }]])
    assert.throws(() => readAnnotationFile({ ...file, elements }), reason("invalid-file"));
  assert.throws(() => copyAnnotationElements(Array(2)), reason("invalid-element"));
});
test("input byte limits are checked before parsing oversized input", () => {
  assert.throws(() => parseAnnotationFile(" ".repeat(MAX_ANNOTATION_FILE_BYTES + 1)), reason("too-large"));
});
test("native file requests cannot supply paths, raw documents or arbitrary actions", () => {
  assert.deepEqual(readAnnotationFileRequest({ displayId: -2, action: "open" }), { displayId: -2, action: "open" });
  for (const value of [{ displayId: 1, action: "save", path: "/tmp/a" }, { displayId: 1, action: "delete" },
    { displayId: 1.5, action: "save" }, null, []]) assert.equal(readAnnotationFileRequest(value), null);
});
test("same-size imports preserve exact coordinates and different screens use uniform centered fitting", () => {
  const file = createAnnotationFile(setup().getSnapshot(1));
  assert.equal(fitAnnotationFile(file, file.viewport), file.elements);
  const small = fitAnnotationFile(file, { width: 100, height: 50 });
  assert.equal(small[0].width, 2); assert.equal(small[0].points[0].x, 5);
  assert.equal(small[6].text, file.elements[6].text); assert.equal(small[6].fontSize, file.elements[6].fontSize);
  const wide = fitAnnotationFile(file, { width: 400, height: 100 });
  assert.equal(wide[0].points[0].x, 110); assert.equal(wide[0].points[0].y, 12);
  assert.equal(wide[4].fill, file.elements[4].fill);
});
test("fitting rejects unrepresentable ink instead of silently changing width or coordinates", () => {
  const h = setup([{ ...pen(), width: 0.5 }]);
  assert.throws(() => fitAnnotationFile(createAnnotationFile(h.getSnapshot(1)), { width: 20, height: 10 }), reason("cannot-fit"));
});
test("document replacement is one atomic Undo entry and preserves the other display", () => {
  const h = setup([pen("old")]); h.setDisplayViewport(2, 200, 100); h.addElement(2, pen("other"));
  const before = h.getSnapshot(1), other = h.getSnapshot(2);
  assert.equal(h.replaceDocumentElements(1, fixture(), before.revision), 1);
  const opened = h.getSnapshot(1); assert.deepEqual(opened.elements, fixture());
  assert.equal(h.getSnapshot(2), other); assert.equal(h.undo(), 1); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
  assert.equal(h.undo(), 2); assert.equal(h.getSnapshot(2).elements.length, 0);
  assert.equal(h.redo(), 2); assert.equal(h.redo(), 1); assert.deepEqual(h.getSnapshot(1).elements, opened.elements);
  assert.deepEqual(before.elements, [pen("old")]);
});
test("invalid replacements and stale revisions never change document, snapshot or Redo", () => {
  const h = setup(); h.addElement(1, pen("redo")); h.undo(); const original = h.getSnapshot(1);
  for (const elements of [[pen(), pen()], [{ ...pen(), width: 1000 }], Array(2)]) {
    assert.throws(() => h.replaceDocumentElements(1, elements, original.revision));
    assert.equal(h.getSnapshot(1), original); assert.ok(h.canRedo);
  }
  assert.throws(() => h.replaceDocumentElements(1, [], original.revision - 1), reason("stale-document"));
  assert.equal(h.getSnapshot(1), original); assert.ok(h.canRedo);
});
test("opening an identical file is a no-op and does not consume Redo", () => {
  const h = setup(); h.addElement(1, pen("redo")); h.undo(); const before = h.getSnapshot(1);
  const file = parseAnnotationFile(serializeAnnotationFile(before));
  assert.equal(h.replaceDocumentElements(1, file.elements, before.revision), null);
  assert.equal(h.getSnapshot(1), before); assert.ok(h.canRedo);
});
test("opening an empty file clears only one display and can be undone", () => {
  const h = setup(), before = h.getSnapshot(1);
  h.replaceDocumentElements(1, [], before.revision); assert.equal(h.getSnapshot(1).elements.length, 0);
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
  h.redo(); assert.equal(h.getSnapshot(1).elements.length, 0);
});
test("replacement history follows viewport changes and checkpoint restoration", () => {
  const h = setup([pen("old")]); h.replaceDocumentElements(1, fixture(), h.getSnapshot(1).revision);
  const checkpoint = h.clone(); h.setDisplayViewport(1, 400, 200);
  const scaled = h.getSnapshot(1); h.undo(); assert.equal(h.getSnapshot(1).elements[0].points[0].x, 20);
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements, scaled.elements);
  h.restoreFrom(checkpoint); assert.deepEqual(h.getSnapshot(1).elements, fixture());
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements, [pen("old")]);
});
test("loaded objects remain editable across move, rotation, reflection, text edit and history", () => {
  const h = setup([]), file = parseAnnotationFile(serializeAnnotationFile(setup().getSnapshot(1)));
  h.replaceDocumentElements(1, file.elements, h.getSnapshot(1).revision);
  const before = h.getSnapshot(1);
  h.translateElements(1, ["text", "box"], 5, 7); h.rotateElements(1, ["box"], { x: 40, y: 30 }, Math.PI / 2);
  h.flipElements(1, ["oval"], { x: 50, y: 40 }, "horizontal");
  h.editText(1, "text", { text: "수정한 내용", fontSize: 20, box: { minX: 0, minY: 0, maxX: 100, maxY: 24 } });
  for (let i = 0; i < 4; i++) h.undo();
  assert.deepEqual(h.getSnapshot(1).elements, before.elements);
});
test("replacement produces a coherent delta/reset and Undo across reused and reordered IDs", () => {
  const h = setup(), before = h.getSnapshot(1);
  h.replaceDocumentElements(1, [...fixture()].reverse(), before.revision);
  const opened = h.getSnapshot(1), update = createAnnotationUpdate(before, opened);
  assert.deepEqual(reduceAnnotationUpdate(before, 1, update).document, opened);
  h.undo(); const undone = h.getSnapshot(1);
  assert.deepEqual(reduceAnnotationUpdate(opened, 1, createAnnotationUpdate(opened, undone)).document, undone);
});
test("the newest full-budget replacement remains undoable and never exceeds document capacity", () => {
  const h = setup([pen("old")]);
  const points = Array.from({ length: 50_000 }, (_, x) => ({ x, y: 1 }));
  const elements = Array.from({ length: MAX_ANNOTATION_POINTS_PER_DISPLAY / points.length }, (_, i) => ({ ...pen(`large-${i}`), points }));
  const before = h.getSnapshot(1); h.replaceDocumentElements(1, elements, before.revision);
  assert.ok(h.canUndo); h.undo(); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
  h.redo(); assert.equal(h.getSnapshot(1).elements.length, elements.length);
  const full = h.getSnapshot(1);
  assert.throws(() => h.replaceDocumentElements(1, [...elements, pen("overflow")], full.revision), reason("point-limit"));
  assert.equal(h.getSnapshot(1), full);
});
test("every file failure has a user-readable explanation", () => {
  for (const value of ["invalid-request", "invalid-file", "unsupported-version", "too-large", "unavailable", "busy", "stale-document", "read-failed", "write-failed", "cannot-fit"])
    assert.ok(annotationFileMessage(value).length > 10);
});


test("centering cannot move a valid text layout beyond coordinate limits", () => {
  const text = { ...fixture()[6], text: "A", box: { minX: 0, minY: 0, maxX: 49900, maxY: 20 },
    points: [{ x: 950000, y: 0 }, { x: 950001, y: 0 }, { x: 950000, y: 1 }] };
  const file = createAnnotationFile(setup([text]).getSnapshot(1));
  assert.throws(() => fitAnnotationFile(file, { width: 100000, height: 100 }), reason("cannot-fit"));
});
