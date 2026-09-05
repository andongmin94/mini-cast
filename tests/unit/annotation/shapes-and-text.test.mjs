import { shapeControlPoints, textControlPoints } from "../../../dist/annotation/primitive-frame.js";
import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, isAnnotationElement, annotationElementCost } from "../../../dist/annotation/history.js";
import { constrainedShapeEnd, hasShapeExtent, elementInkPaths, elementInkBounds } from "../../../dist/annotation/shape-geometry.js";
import { prepareEraserElement, eraserSweepHitsPreparedElement } from "../../../dist/annotation/eraser-index.js";
import { eraserSweepHitsStroke } from "../../../dist/annotation/geometry.js";
import { readAnnotationTextDraft, createTextElement, MAX_ANNOTATION_TEXT_LENGTH } from "../../../dist/annotation/text.js";
import { createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";
import { planCommittedRender } from "../../../dist/annotation/render-plan.js";

const point = (x, y) => ({ x, y });
const shape = (tool, id = tool) => ({ id, tool, points: shapeControlPoints(tool, point(10, 10), point(110, 70)), color: "#FF0000", width: 4, opacity: 1 });
const text = () => ({ id: "text", tool: "text", points: textControlPoints(point(20, 20)), color: "#007AFF", opacity: 1, text: "한글 ABC\n둘째 줄", fontSize: 28, box: { minX: -1, minY: 0, maxX: 120, maxY: 78.4 } });
const view = elements => ({ displayId: 1, viewportWidth: 200, viewportHeight: 120, canvasWidth: 200, canvasHeight: 120, pixelRatio: 1, elements });

for (const tool of ["line", "arrow", "rectangle", "ellipse"]) {
  test(`${tool} stores exact anchors and survives object erase, Undo and Redo`, () => {
    const h = new AnnotationHistory(); const input = shape(tool);
    h.addElement(1, input);
    assert.equal(isAnnotationElement(input), true);
    input.points[1].x = 999;
    const stored = h.getSnapshot(1).elements[0];
    assert.equal(stored.points.length, tool === "rectangle" || tool === "ellipse" ? 3 : 2); assert.equal(stored.points[1].x, 110);
    assert.equal(Object.isFrozen(stored.points[0]), true);
    h.removeElements(1, [stored.id]); assert.equal(h.getSnapshot(1).elements.length, 0);
    h.undo(); assert.deepEqual(h.getSnapshot(1).elements, [stored]);
    h.redo(); assert.deepEqual(h.getSnapshot(1).elements, []);
  });
}

test("invalid shape tools, extra anchors, alpha and geometry are rejected", () => {
  for (const bad of [{ ...shape("line"), points: [] }, { ...shape("arrow"), points: [point(1, 1)] }, { ...shape("ellipse"), points: [point(1, 1), point(Infinity, 3)] }, { ...shape("rectangle"), opacity: 0.5 }, shape("polygon")]) assert.equal(isAnnotationElement(bad), false);
});

test("Shift locks box aspect and line angle in all drag quadrants", () => {
  for (const [x, y] of [[50, 20], [-50, 20], [50, -20], [-50, -20]]) {
    const end = constrainedShapeEnd("rectangle", point(0, 0), point(x, y), true);
    assert.equal(Math.abs(end.x), Math.abs(end.y)); assert.equal(Math.sign(end.x), Math.sign(x)); assert.equal(Math.sign(end.y), Math.sign(y));
    const line = constrainedShapeEnd("arrow", point(0, 0), point(x, y), true);
    const eighths = Math.atan2(line.y, line.x) / (Math.PI / 4);
    assert.ok(Math.abs(eighths - Math.round(eighths)) < 1e-10);
  }
  assert.deepEqual(constrainedShapeEnd("line", point(3, 4), point(8, 9), false), point(8, 9));
});

test("click-only shapes and degenerate boxes create no UI gesture extent", () => {
  assert.equal(hasShapeExtent("line", point(2, 2), point(2, 2)), false);
  assert.equal(hasShapeExtent("ellipse", point(2, 2), point(2, 50)), false);
  assert.equal(hasShapeExtent("line", point(2, 2), point(2, 50)), true);
});

test("arrowhead erases and invalidates pixels beyond the shaft", () => {
  const element = { ...shape("arrow"), points: [point(20, 50), point(110, 50)], width: 8 };
  const wing = elementInkPaths(element)[1][0];
  assert.ok(wing.y > 50); assert.ok(elementInkBounds(element).maxY > wing.y);
  assert.equal(eraserSweepHitsPreparedElement(wing, wing, prepareEraserElement(element), 0), true);
  const plan = planCommittedRender(view([element]), view([]));
  assert.ok(plan.clear.y + plan.clear.height > wing.y);
});

test("hollow rectangle and ellipse do not erase when only their interior is touched", () => {
  for (const tool of ["rectangle", "ellipse"]) {
    const element = shape(tool); const prepared = prepareEraserElement(element);
    assert.equal(eraserSweepHitsPreparedElement(point(50, 30), point(60, 40), prepared, 2), false);
    assert.equal(eraserSweepHitsPreparedElement(point(0, 40), point(150, 40), prepared, 1), true);
  }
});

test("ellipse extrema and narrow outlines remain hit-testable", () => {
  const element = shape("ellipse"); const prepared = prepareEraserElement(element);
  for (const p of [point(10, 40), point(110, 40), point(60, 10), point(60, 70)]) assert.equal(eraserSweepHitsPreparedElement(p, p, prepared, 0), true);
  const narrow = { ...element, points: shapeControlPoints("ellipse", point(10, 10), point(11, 150)) };
  assert.equal(eraserSweepHitsPreparedElement(point(10.5, 9), point(10.5, 20), prepareEraserElement(narrow), 1), true);
});

test("shape broad phase matches exhaustive geometry for seeded sweeps", () => {
  let seed = 12345; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const tool of ["line", "arrow", "rectangle", "ellipse"]) for (let i = 0;i < 250;i++) {
    const element = { ...shape(tool), points: shapeControlPoints(tool, point(random() * 200 - 100, random() * 200 - 100), point(random() * 200 - 100, random() * 200 - 100)), width: 0.5 + random() * 30 };
    const a = point(random() * 240 - 120, random() * 240 - 120), b = point(random() * 240 - 120, random() * 240 - 120), radius = random() * 20;
    assert.equal(eraserSweepHitsPreparedElement(a, b, prepareEraserElement(element), radius), eraserSweepHitsStroke(a, b, element, radius));
  }
});

test("text normalization supports Korean, emoji, CRLF and multiline plain text", () => {
  const draft = readAnnotationTextDraft({ text: "제목 🖊️\r\n\t<script>그대로</script>", fontSize: 28 });
  assert.equal(draft.text, "제목 🖊️\n    <script>그대로</script>");
});

test("text draft rejects empty, oversized and invalid inputs", () => {
  for (const value of [null, {}, { text: " ", fontSize: 28 }, { text: "x", fontSize: NaN }, { text: "x", fontSize: 0 }, { text: "x", fontSize: 97 }, { text: "\u0000", fontSize: 28 }, { text: "x".repeat(MAX_ANNOTATION_TEXT_LENGTH + 1), fontSize: 28 }, { text: Array(21).fill("x").join("\n"), fontSize: 28 }]) assert.equal(readAnnotationTextDraft(value), null);
});

test("text element validates metrics and does not accept image/HTML payloads", () => {
  assert.equal(isAnnotationElement(text()), true);
  for (const item of [{ ...text(), points: textControlPoints(point(20,20), 0, 1) }, { ...text(), box: { minX: 0, minY: 0, maxX: NaN, maxY: 10 } }, { ...text(), box: { minX: 0, minY: 0, maxX: 0, maxY: 10 } }, { ...text(), points: [point(1, 1), point(2, 2)] }, { ...text(), opacity: 0.35 }]) assert.equal(isAnnotationElement(item), false);
});

test("text has deeply immutable bounds, bounded storage cost and global Undo", () => {
  const h = new AnnotationHistory(); const input = text();
  h.addElement(1, input); const stored = h.getSnapshot(1).elements[0];
  input.box.maxX = 999; input.points[0].x = 999;
  assert.equal(stored.box.maxX, 120); assert.equal(stored.points[0].x, 20); assert.equal(Object.isFrozen(stored.box), true);
  assert.equal(annotationElementCost(stored), stored.text.length + 3);
  h.addElement(2, shape("arrow")); assert.equal(h.undo(), 2); assert.equal(h.undo(), 1); assert.equal(h.redo(), 1);
  assert.deepEqual(h.getSnapshot(1).elements, [stored]);
});

test("text viewport scaling keeps layout and history aligned on both axes", () => {
  const h = new AnnotationHistory(); h.setDisplayViewport(1, 200, 100); h.addElement(1, text());
  const before = h.getSnapshot(1).elements[0]; h.setDisplayViewport(1, 400, 50); const after = h.getSnapshot(1).elements[0];
  assert.deepEqual(after.points, textControlPoints(point(40, 10), 2, 0.5));
  assert.deepEqual(before.points, textControlPoints(point(20, 20))); assert.equal(after.text, before.text);
  h.undo(); h.redo(); assert.deepEqual(h.getSnapshot(1).elements, [after]);
});

test("text erase uses its layout box, not only the insertion point", () => {
  const element = text(); const prepared = prepareEraserElement(element);
  assert.equal(eraserSweepHitsPreparedElement(point(130, 65), point(130, 65), prepared, 0), true);
  assert.equal(eraserSweepHitsPreparedElement(point(160, 110), point(160, 110), prepared, 1), false);
});

test("text measurement includes glyph overhang and all line baselines", () => {
  let saved = 0; const ctx = { save() { saved++; }, restore() { saved--; }, measureText(line) { return { width: line.length * 12, actualBoundingBoxLeft: 2, actualBoundingBoxRight: line.length * 12 + 3, actualBoundingBoxAscent: 24, actualBoundingBoxDescent: 8 }; } };
  const element = createTextElement(ctx, "measured", { text: "한글\nABC", fontSize: 28 }, point(10, 10), "#007AFF");
  assert.equal(saved, 0); assert.equal(element.box.minX, -2); assert.equal(element.box.maxX, 39);
  assert.ok(element.box.maxY >= 75.2); assert.equal(isAnnotationElement(element), true);
});

test("mixed-element delta protocol preserves text metadata and shape geometry", () => {
  const h = new AnnotationHistory(); let previous = h.getSnapshot(1); let replica = previous;
  for (const input of [shape("line"), text(), shape("ellipse"), shape("arrow")]) {
    h.addElement(1, input); const next = h.getSnapshot(1); const delta = createAnnotationUpdate(previous, next);
    const decision = reduceAnnotationUpdate(replica, 1, structuredClone(delta)); assert.equal(decision.kind, "adopt"); replica = decision.document;
    assert.deepEqual(replica, next); previous = next;
  }
  h.removeElements(1, ["text", "line"]); let next = h.getSnapshot(1); replica = reduceAnnotationUpdate(replica, 1, createAnnotationUpdate(previous, next)).document; previous = next;
  h.undo(); next = h.getSnapshot(1); replica = reduceAnnotationUpdate(replica, 1, createAnnotationUpdate(previous, next)).document;
  assert.deepEqual(replica, next);
});

test("text and nearby translucent ink participate in the same dirty recomposition", () => {
  const ink = { id: "hi", tool: "highlighter", color: "#FFFF00", width: 8, opacity: 0.35, points: [point(1, 30), point(160, 30)] };
  const element = text(); const plan = planCommittedRender(view([ink, element]), view([ink]));
  assert.equal(plan.kind, "dirty"); assert.deepEqual(plan.elements, [ink]); assert.ok(plan.clear.x < 20); assert.ok(plan.clear.width > 100);
});

test("text control-character policy preserves normalized whitespace and rejects every other C0 code", () => {
  for (let code = 0; code < 32; code += 1) {
    const result = readAnnotationTextDraft({ text: "A" + String.fromCharCode(code) + "B", fontSize: 28 });
    assert.equal(result !== null, [9, 10, 13].includes(code), `C0 code ${code}`);
  }
  assert.equal(readAnnotationTextDraft({ text: "A" + String.fromCharCode(127) + "B", fontSize: 28 }), null);
});


test("text validation accepts reflected frames and still rejects either collapsed axis", () => {
  for (const [sx, sy] of [[-1, 1], [1, -1], [-1, -1]]) {
    assert.equal(isAnnotationElement({ ...text(), points: textControlPoints(point(20, 20), sx, sy) }), true);
  }
  for (const [sx, sy] of [[0, 1], [1, 0], [0, 0]]) {
    assert.equal(isAnnotationElement({ ...text(), points: textControlPoints(point(20, 20), sx, sy) }), false);
  }
});
