import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnotationHistory, flipAnnotationElement, isFlipAxis, isAnnotationElement,
  rotateAnnotationElement, resizeAnnotationElement, replaceAnnotationText, annotationElementCost,
} from "../../../dist/annotation/history.js";
import {
  annotationSelectionBounds, applyAnnotationSelectionEdit, flipSelectionElements, readAnnotationSelectionEdit,
} from "../../../dist/annotation/selection.js";
import { selectionRotationCenter, rotatePoint } from "../../../dist/annotation/rotation.js";
import { shapeControlPoints, textControlPoints, framePoint, validTextFrame } from "../../../dist/annotation/primitive-frame.js";
import { elementInkBounds } from "../../../dist/annotation/shape-geometry.js";
import { pointHitsStroke, eraserSweepHitsStroke } from "../../../dist/annotation/geometry.js";
import { prepareEraserElement, eraserSweepHitsPreparedElement } from "../../../dist/annotation/eraser-index.js";
import { AnnotationReplica, createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const tools = ["pen", "highlighter", "line", "arrow", "rectangle", "ellipse", "text"];
const axes = ["horizontal", "vertical"];
const point = (x, y) => ({ x, y });
const closePoint = (a, b) => {
  assert.ok(Math.abs(a.x - b.x) < 1e-8, `${a.x} != ${b.x}`);
  assert.ok(Math.abs(a.y - b.y) < 1e-8, `${a.y} != ${b.y}`);
};
const make = (tool, id = tool) => tool === "text"
  ? { id, tool, color: "#123456", opacity: 1, points: textControlPoints(point(100, 80)),
    text: "한글 ABC\nflip", fontSize: 28, box: { minX: -2, minY: 0, maxX: 120, maxY: 70 } }
  : { id, tool, color: "#123456", opacity: tool === "highlighter" ? 0.35 : 1, width: 4,
    points: shapeControlPoints(tool, point(30, 40), point(150, 100)) };
function setup() {
  const h = new AnnotationHistory(); h.setDisplayViewport(1, 800, 600);
  for (const tool of tools) h.addElement(1, make(tool));
  return h;
}
function edit(h, ids, axis, revision = h.getSnapshot(1).revision) {
  return applyAnnotationSelectionEdit(h, 1, { kind: "flip", revision, ids, axis });
}

for (const tool of tools) for (const axis of axes) test(`${tool} ${axis} flip preserves style, identity and exact Undo/Redo`, () => {
  const h = new AnnotationHistory(); h.addElement(1, make(tool));
  const before = h.getSnapshot(1), selected = new Set([tool]);
  const bounds = annotationSelectionBounds(before.elements, selected);
  const expectedPoints = before.elements[0].points.map(p => point(
    axis === "horizontal" ? bounds.minX + bounds.maxX - p.x : p.x,
    axis === "vertical" ? bounds.minY + bounds.maxY - p.y : p.y,
  ));
  const preview = flipSelectionElements(before.elements, selected, axis);
  edit(h, [tool], axis); const after = h.getSnapshot(1);
  assert.deepEqual(after.elements, preview);
  assert.deepEqual(after.elements[0].points, expectedPoints);
  assert.equal(after.revision, before.revision + 1);
  const { points: ignored, ...style } = before.elements[0];
  assert.ok(ignored.length);
  const { points: changed, ...nextStyle } = after.elements[0];
  assert.ok(changed.length); assert.deepEqual(nextStyle, style);
  assert.equal(isAnnotationElement(after.elements[0]), true);
  assert.ok(Object.isFrozen(after.elements[0].points[0]));
  assert.equal(annotationElementCost(after.elements[0]), annotationElementCost(before.elements[0]));
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements, after.elements);
});

test("flip requests validate axes and IDs and ignore untrusted centers", () => {
  for (const axis of axes) assert.equal(isFlipAxis(axis), true);
  for (const axis of [null, undefined, "x", "y", "diagonal", 1, {}, NaN]) {
    assert.equal(isFlipAxis(axis), false);
    assert.equal(readAnnotationSelectionEdit({ kind: "flip", axis, ids: ["pen"], revision: 1 }), null);
  }
  const h = setup(), before = h.getSnapshot(1);
  for (const value of [
    { kind: "flip", axis: "horizontal", ids: [], revision: before.revision },
    { kind: "flip", axis: "vertical", ids: ["pen", "pen"], revision: before.revision },
    { kind: "flip", axis: "vertical", ids: ["pen"], revision: NaN },
  ]) assert.throws(() => applyAnnotationSelectionEdit(h, 1, value));
  assert.strictEqual(h.getSnapshot(1), before);
  const expected = flipSelectionElements(before.elements, new Set(["pen"]), "horizontal");
  applyAnnotationSelectionEdit(h, 1, { kind: "flip", axis: "horizontal", ids: ["pen"], revision: before.revision,
    center: { x: 999999, y: -999999 }, points: [] });
  assert.deepEqual(h.getSnapshot(1).elements, expected);
});

test("mixed groups flip around one shared center and leave unrelated objects untouched", () => {
  const h = setup(), before = h.getSnapshot(1), ids = ["pen", "rectangle", "text"];
  const c = selectionRotationCenter(annotationSelectionBounds(before.elements, new Set(ids)));
  edit(h, ids, "horizontal"); const after = h.getSnapshot(1);
  before.elements.forEach((element, index) => {
    if (!ids.includes(element.id)) assert.strictEqual(after.elements[index], element);
    else assert.deepEqual(after.elements[index].points, element.points.map(p => point(2 * c.x - p.x, p.y)));
  });
  assert.deepEqual(after.elements.map(e => e.id), before.elements.map(e => e.id));
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
});

test("a centered point flip is a true no-op and preserves Redo and cached snapshots", () => {
  const h = new AnnotationHistory();
  h.addElement(1, { ...make("pen", "dot"), points: [point(12.25, 16.5)] });
  h.addElement(1, make("pen", "temporary")); h.undo();
  const before = h.getSnapshot(1);
  for (const axis of axes) {
    assert.equal(edit(h, ["dot"], axis), null);
    assert.strictEqual(h.getSnapshot(1), before); assert.equal(h.canRedo, true);
    assert.strictEqual(flipSelectionElements(before.elements, new Set(["dot"]), axis), before.elements);
  }
});

test("stale revisions, missing objects and coordinate overflow reject complete groups", () => {
  const h = setup(), before = h.getSnapshot(1);
  assert.throws(() => edit(h, ["pen"], "horizontal", before.revision - 1), e => e.reason === "stale-document");
  assert.throws(() => edit(h, ["pen", "missing"], "vertical"), e => e.reason === "stale-document");
  assert.throws(() => h.flipElements(1, ["pen", "text"], point(-1000000, 0), "horizontal"), e => e.reason === "invalid-element");
  assert.strictEqual(h.getSnapshot(1), before);
  for (const center of [point(NaN, 0), point(0, Infinity), point(1000001, 0)])
    assert.throws(() => flipAnnotationElement(make("pen"), center, "horizontal"));
});

test("reflected text accepts either orientation but still rejects collapsed and overflowing frames", () => {
  const text = flipAnnotationElement(make("text"), point(120, 100), "horizontal");
  assert.equal(validTextFrame(text.points, text.box, 1000000), true);
  assert.equal(isAnnotationElement({ ...text, points: [text.points[0], text.points[0], text.points[2]] }), false);
  assert.equal(isAnnotationElement({ ...text, points: [point(0, 0), point(-100001, 0), point(0, 1)] }), false);
  assert.equal(isAnnotationElement({ ...text, box: { ...text.box, maxX: Infinity } }), false);
});

test("reflection composes with rotation and anisotropic resize without losing primitive geometry", () => {
  const c = point(90, 70), anchor = point(10, 20);
  for (const tool of ["rectangle", "ellipse", "text"]) for (const axis of axes) {
    const original = make(tool);
    const rotated = rotateAnnotationElement(original, c, Math.PI / 4);
    const mirrored = flipAnnotationElement(rotated, c, axis);
    const resized = resizeAnnotationElement(mirrored, anchor, 1.75, 0.625);
    assert.equal(isAnnotationElement(resized), true);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [0.5, 0.5], [0.2, 0.8]]) {
      const p = rotatePoint(framePoint(original.points, u, v), c, Math.PI / 4);
      const q = point(axis === "horizontal" ? 2 * c.x - p.x : p.x, axis === "vertical" ? 2 * c.y - p.y : p.y);
      closePoint(framePoint(resized.points, u, v), point(anchor.x + (q.x - anchor.x) * 1.75, anchor.y + (q.y - anchor.y) * 0.625));
    }
  }
});

test("mirrored rotated text can be selected, erased and edited without unmirroring it", () => {
  const original = rotateAnnotationElement(make("text"), point(100, 80), Math.PI / 4);
  const mirrored = flipAnnotationElement(original, point(100, 80), "horizontal");
  const inside = framePoint(mirrored.points, 30, 20), box = elementInkBounds(mirrored);
  const outside = point(box.minX + 0.1, box.minY + 0.1);
  assert.equal(pointHitsStroke(inside, mirrored, 0), true);
  assert.equal(pointHitsStroke(outside, mirrored, 0), false);
  assert.equal(eraserSweepHitsPreparedElement(inside, inside, prepareEraserElement(mirrored), 0), true);
  assert.equal(eraserSweepHitsPreparedElement(outside, outside, prepareEraserElement(mirrored), 0), false);
  const replacement = replaceAnnotationText(mirrored, { text: "반전 수정", fontSize: 32, box: mirrored.box });
  assert.deepEqual(replacement.points, mirrored.points);
  assert.equal(replacement.text, "반전 수정"); assert.equal(isAnnotationElement(replacement), true);
  const h = new AnnotationHistory(); h.addElement(1, mirrored);
  h.editText(1, mirrored.id, { text: replacement.text, fontSize: replacement.fontSize, box: replacement.box });
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements[0], mirrored);
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements[0], replacement);
});

test("mirrored ellipse, arrow and text broad-phase erasing matches the exact path kernel", () => {
  let seed = 431;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const tool of tools) for (const axis of axes) {
    const element = flipAnnotationElement(rotateAnnotationElement(make(tool), point(100, 80), 0.63), point(100, 80), axis);
    const prepared = prepareEraserElement(element);
    for (let i = 0; i < 100; i++) {
      const a = point(random() * 300 - 50, random() * 260 - 50), b = point(random() * 300 - 50, random() * 260 - 50);
      const radius = random() * 10;
      assert.equal(eraserSweepHitsPreparedElement(a, b, prepared, radius), eraserSweepHitsStroke(a, b, element, radius));
    }
  }
});

test("flip history survives viewport rebasing, checkpoints and global cross-display Undo", () => {
  const h = setup(); h.addElement(2, make("pen", "other"));
  const before = h.getSnapshot(1); edit(h, ["text", "ellipse"], "vertical");
  const checkpoint = h.clone(); h.setDisplayViewport(1, 1200, 300);
  const after = h.getSnapshot(1); h.undo();
  before.elements.forEach((e, i) => e.points.forEach((p, j) => closePoint(h.getSnapshot(1).elements[i].points[j], point(p.x * 1.5, p.y * 0.5))));
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements, after.elements);
  h.restoreFrom(checkpoint); assert.equal(h.undo(), 1); assert.equal(h.undo(), 2);
});

test("flip deltas carry only modified objects and late replies cannot resurrect undone geometry", async () => {
  const h = setup(), before = h.getSnapshot(1), replica = new AnnotationReplica(async () => h.getSnapshot(1), () => {});
  replica.reset(1); await replica.receive({ kind: "snapshot", document: before });
  edit(h, ["text"], "horizontal"); const after = h.getSnapshot(1), delta = createAnnotationUpdate(before, after);
  assert.equal(delta.kind, "delta"); assert.equal(delta.inserted.length, 1); assert.deepEqual(delta.removedIds, ["text"]);
  assert.deepEqual(reduceAnnotationUpdate(before, 1, delta).document, after);
  h.undo(); const undone = h.getSnapshot(1);
  await replica.receive(createAnnotationUpdate(after, undone)); await replica.receive(delta);
  assert.deepEqual(replica.document, undone);
});

test("repeated group flips preserve prior immutable snapshots and exact Undo/Redo content", () => {
  const h = setup(), retained = [];
  for (let i = 0; i < 400; i++) {
    const before = h.getSnapshot(1); retained.push([before, JSON.stringify(before)]);
    edit(h, ["pen", "rectangle", "text"], axes[i % 2]);
    const after = h.getSnapshot(1); h.undo(); assert.deepEqual(h.getSnapshot(1).elements, before.elements);
    h.redo(); assert.deepEqual(h.getSnapshot(1).elements, after.elements);
  }
  for (const [snapshot, json] of retained) assert.equal(JSON.stringify(snapshot), json);
});
