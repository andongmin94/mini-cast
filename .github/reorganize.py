"""One-run preparation for the reviewed 0.9.0 selection-flip increment.
The existing opt-in Windows job checks the complete working tree before committing
it and removes this file. No branch, automatic trigger, or dependency is added.
"""
from pathlib import Path
import json
import subprocess

BASE = '4ffdd04c09d46b876ff400d33d6738e61c49d996'

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, source):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding='utf-8', newline='\n')

def replace(path, old, new, count=1):
    source = read(path)
    if source.count(old) != count:
        raise RuntimeError(f'Unexpected source in {path}: {old[:100]}')
    write(path, source.replace(old, new))

package = json.loads(read('package.json'))
original_version = package['version']
package['scripts']['precheck'] = "node -e \"throw new Error('Selection flip preparation incomplete; refusing to validate an old product')\""
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')
try:
    assert original_version == '0.8.0'
    subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', BASE], check=True)
    subprocess.run(['git', 'diff', '--quiet', BASE, 'HEAD', '--', 'src', 'tests', 'scripts', 'docs', 'README.md', 'package.json', 'package-lock.json', '.github/workflows'], check=True)

    replace('src/annotation/history.ts', 'export type ShapeTool =', '''export type FlipAxis = "horizontal" | "vertical";
export function isFlipAxis(value: unknown): value is FlipAxis {
  return value === "horizontal" || value === "vertical";
}

export type ShapeTool =''')
    replace('src/annotation/history.ts', '/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */', '''/** Reflect world coordinates while retaining identity, style and primitive frames.
 * Text is mirrored, not relaid out; a collapsed or overflowing frame is rejected. */
export function flipAnnotationElement(element: AnnotationElement, center: AnnotationPoint, axis: FlipAxis): AnnotationElement {
  if (!isFinitePoint(center) || !isFlipAxis(axis) || !isAnnotationElement(element))
    throw new AnnotationError("invalid-element");
  const points = element.points.map(point => ({
    x: axis === "horizontal" ? 2 * center.x - point.x : point.x,
    y: axis === "vertical" ? 2 * center.y - point.y : point.y,
  }));
  if (points.every((point, index) => point.x === element.points[index].x && point.y === element.points[index].y)) return element;
  const flipped = { ...element, points };
  if (!isAnnotationElement(flipped)) throw new AnnotationError("invalid-element");
  return immutableElement(flipped);
}

/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */''')
    replace('src/annotation/history.ts', '  editText(displayId: number, id: string, value: unknown) {', '''  flipElements(displayId: number, ids: Iterable<string>, center: AnnotationPoint, axis: FlipAxis) {
    if (!isFinitePoint(center) || !isFlipAxis(axis)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, false,
      element => flipAnnotationElement(element, center, axis));
  }

  editText(displayId: number, id: string, value: unknown) {''')
    replace('src/annotation/history.ts', '''    const changes = document.elements.flatMap((before, index) => selected.has(before.id)
      ? [{ index, before, after: transform(before) }] : []);
    const entry: TransformHistoryEntry''', '''    const changes = document.elements.flatMap((before, index) => {
      if (!selected.has(before.id)) return [];
      const after = transform(before);
      return after === before ? [] : [{ index, before, after }];
    });
    if (!changes.length) return null;
    const entry: TransformHistoryEntry''')
    replace('src/annotation/primitive-frame.ts', 'Number.isFinite(determinant) && determinant > 0 &&', '''// Either orientation is valid. Reflection reverses it without collapsing the frame.
    Number.isFinite(determinant) && determinant !== 0 &&''')
    replace('src/annotation/selection.ts', '  rotateAnnotationElement,', '  rotateAnnotationElement,\n  flipAnnotationElement,\n  isFlipAxis,\n  type FlipAxis,')
    replace('src/annotation/selection.ts', '  | (SelectionEditBase & { readonly kind: "delete" });', '  | (SelectionEditBase & { readonly kind: "flip"; readonly axis: FlipAxis })\n  | (SelectionEditBase & { readonly kind: "delete" });')
    replace('src/annotation/selection.ts', '  if (data.kind === "rotate") {', '''  if (data.kind === "flip") return isFlipAxis(data.axis)
    ? { kind: "flip", revision: data.revision, ids, axis: data.axis } : null;
  if (data.kind === "rotate") {''')
    replace('src/annotation/selection.ts', '  if (edit.kind === "rotate") return history.rotateElements', '  if (edit.kind === "flip") return history.flipElements(displayId, edit.ids, selectionRotationCenter(bounds), edit.axis);\n  if (edit.kind === "rotate") return history.rotateElements')
    write('src/annotation/selection.ts', read('src/annotation/selection.ts') + '''
/** A group reflects about its shared visible center, never each element's center. */
export function flipSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, axis: FlipAxis): readonly AnnotationElement[] {
  if (!isFlipAxis(axis)) throw new AnnotationError("invalid-element");
  const bounds = annotationSelectionBounds(elements, selected);
  if (!bounds) return elements;
  const center = selectionRotationCenter(bounds);
  let changed = false;
  const result = elements.map(element => {
    if (!selected.has(element.id)) return element;
    const next = flipAnnotationElement(element, center, axis);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? result : elements;
}
''')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', 'AnnotationDocumentSnapshot, AnnotationElement, AnnotationPoint }', 'AnnotationDocumentSnapshot, AnnotationElement, AnnotationPoint, FlipAxis }')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', 'resizeSelectionElements, rotateSelectionElements, type AnnotationSelectionEdit,', 'resizeSelectionElements, rotateSelectionElements, flipSelectionElements, type AnnotationSelectionEdit,')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', '  function deleteSelected() {', '''  function flipSelected(axis: FlipAxis) {
    const source = current.current;
    if (!source || source.displayId !== displayId || pending.current || drag.current ||
        openingEditor.current || !selected.current.length || typeof miniCast === "undefined") return;
    const ids = [...selected.current];
    setNotice(null);
    try {
      const preview = flipSelectionElements(source.elements, new Set(ids), axis);
      if (preview === source.elements) return;
      const id = crypto.randomUUID();
      miniCast.beginAnnotationGesture(id);
      void submit(id, { kind: "flip", revision: source.revision, ids, axis }, preview);
    } catch {
      setNotice("반전 가능한 좌표 범위를 벗어나 적용하지 않았습니다. 기존 판서는 유지됩니다.");
    }
  }

  function deleteSelected() {''')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', 'fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg', 'fixed bottom-4 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', '<span role="status">{busy ?', '<span role="status" className="basis-full text-center">{busy ?')
    replace('src/renderer/components/AnnotationSelectionSurface.tsx', '        <button type="button" data-selection-text-edit=""', '''        <button type="button" data-selection-flip="horizontal" disabled={busy || !count}
          title="선택 영역 중심을 기준으로 좌우 반전"
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40" onClick={() => flipSelected("horizontal")}>좌우 반전</button>
        <button type="button" data-selection-flip="vertical" disabled={busy || !count}
          title="선택 영역 중심을 기준으로 상하 반전"
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40" onClick={() => flipSelected("vertical")}>상하 반전</button>
        <button type="button" data-selection-text-edit=""''')

    write('tests/unit/annotation/flip.test.mjs', r'''import assert from "node:assert/strict";
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
''')

    write('src/electron/testing/flip-smoke.ts', r'''import assert from "node:assert/strict";
import { screen } from "electron";
import type { AnnotationHistory, AnnotationElement, AnnotationPoint, FlipAxis } from "../../annotation/history.js";
import { flipSelectionElements } from "../../annotation/selection.js";
import { framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, waitFor } from "./smoke.js";

interface FlipSmokeContext {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  activateSelection(): Promise<void>;
}

/** Fixture construction and observation are direct; selection and flips use native input. */
export async function verifySelectionFlip(context: FlipSmokeContext, displayId: number) {
  const target = overlayWindows[overlayDisplays.findIndex(display => display.id === displayId)];
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!target || !display) throw new Error("Missing native flip surface");
  const contents = target.webContents;
  const query = (source: string) => contents.executeJavaScript(source);
  const snapshot = () => context.history.getSnapshot(displayId);
  const screenPoint = (p: AnnotationPoint) => ({ x: Math.round(display.bounds.x + p.x), y: Math.round(display.bounds.y + p.y) });
  const ready = async () => {
    await waitFor(async () => {
      const state = await query(`(() => ({ revision:Number(document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision),
        busy:document.querySelector('[data-annotation-selection-busy]')?.dataset.annotationSelectionBusy }))()`);
      return state.revision === snapshot().revision && state.busy === "false";
    }, 5000, "flip document and renderer settle");
  };
  const count = async (expected: number) => {
    await waitFor(async () => Number(await query(`document.querySelector('[data-annotation-selection-count]')?.dataset.annotationSelectionCount`)) === expected,
      5000, `${expected} selected flip objects`);
  };
  const click = async (p: AnnotationPoint, shift = false) => {
    const absolute = screenPoint(p);
    if (shift) await injectWindowsDrag(absolute.x, absolute.y, absolute.x, absolute.y, ["Shift"]);
    else await injectWindowsClick(absolute.x, absolute.y);
  };
  const clickButton = async (selector: string) => {
    const p = await query(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.disabled) throw new Error('Flip control not available');
      const r = node.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
      if (r.left<0 || r.top<0 || r.right>innerWidth || r.bottom>innerHeight || document.elementFromPoint(x,y)!==node)
        throw new Error('Flip toolbar target is clipped or obscured');
      return {x,y};
    })()`);
    await click(p);
  };
  const expectElements = async (elements: readonly AnnotationElement[], label: string) => {
    await waitFor(() => JSON.stringify(snapshot().elements) === JSON.stringify(elements), 5000, label);
    await ready();
  };
  await context.activateSelection();
  mainWindow?.setBounds({ x: display.bounds.x + Math.max(0, display.bounds.width - 426),
    y: display.bounds.y + 10, width: 416, height: 420 }, false);
  context.history.clearDisplay(displayId); context.publishDocument(displayId);
  await ready(); await count(0);
  assert.equal(await query(`Array.from(document.querySelectorAll('[data-selection-flip]')).filter(n => n.disabled).length`), 2);
  const pen: AnnotationElement = { id:"flip-pen", tool:"pen", color:"#123456", width:4, opacity:1,
    points:[{x:80,y:100},{x:190,y:110},{x:140,y:160}] };
  context.history.addElement(displayId, pen); context.publishDocument(displayId); await ready();
  await click(pen.points[0]); await count(1);
  for (const axis of ["horizontal", "vertical"] as const) {
    const before = snapshot();
    const preview = flipSelectionElements(before.elements, new Set([pen.id]), axis);
    await query(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__miniCastFlipPixels = document.querySelector('canvas').toDataURL(); resolve(true);
    })))`);
    await clickButton(`[data-selection-flip="${axis}"]`);
    await expectElements(preview, `native ${axis} flip`);
    assert.equal(snapshot().revision, before.revision + 1, "Flip must be one transaction");
    await waitFor(async () => await query(`document.querySelector('canvas').toDataURL() !== window.__miniCastFlipPixels`), 5000, "flip changes visible pixels");
    await context.command("undo"); await expectElements(before.elements, "native flip Undo");
    await waitFor(async () => await query(`document.querySelector('canvas').toDataURL() === window.__miniCastFlipPixels`), 5000, "flip Undo restores exact pixels");
    await context.command("redo"); await expectElements(preview, "native flip Redo");
    await context.command("undo"); await expectElements(before.elements, "restore before next flip");
  }
  await query("delete window.__miniCastFlipPixels");

  const elements: AnnotationElement[] = [
    { ...pen, points:[{x:80,y:70},{x:145,y:75},{x:115,y:100}] },
    { id:"flip-highlighter",tool:"highlighter",color:"#FFD60A",width:10,opacity:0.35,points:[{x:90,y:120},{x:145,y:125}] },
    { id:"flip-line",tool:"line",color:"#123456",width:4,opacity:1,points:[{x:80,y:175},{x:140,y:185}] },
    { id:"flip-arrow",tool:"arrow",color:"#123456",width:4,opacity:1,points:[{x:190,y:80},{x:270,y:100}] },
    { id:"flip-rectangle",tool:"rectangle",color:"#123456",width:4,opacity:1,points:[{x:200,y:145},{x:285,y:160},{x:185,y:210}] },
    { id:"flip-ellipse",tool:"ellipse",color:"#123456",width:4,opacity:1,points:[{x:340,y:155},{x:445,y:175},{x:320,y:225}] },
    { id:"flip-text",tool:"text",color:"#123456",opacity:1,points:[{x:90,y:260},{x:91,y:260.25},{x:89.75,y:261}],
      text:"반전 ABC",fontSize:24,box:{minX:0,minY:-2,maxX:100,maxY:36} },
  ];
  context.history.clearDisplay(displayId);
  for (const element of elements) context.history.addElement(displayId, element);
  context.publishDocument(displayId); await ready();
  await click({x:30,y:330}); await count(0);
  for (let i=0; i<elements.length; i++) {
    const element=elements[i];
    const p=element.tool === "ellipse" ? framePoint(element.points,1,0.5)
      : element.tool === "text" ? framePoint(element.points,10,10) : element.points[0];
    await click(p,i>0); await count(i+1);
  }
  const ids=new Set(elements.map(element=>element.id));
  const beforeGroup=snapshot();
  const horizontal=flipSelectionElements(beforeGroup.elements,ids,"horizontal");
  await clickButton('[data-selection-flip="horizontal"]');
  await expectElements(horizontal,"native mixed-group horizontal flip");
  assert.equal(snapshot().revision,beforeGroup.revision+1);
  const vertical=flipSelectionElements(snapshot().elements,ids,"vertical");
  await clickButton('[data-selection-flip="vertical"]');
  await expectElements(vertical,"native mixed-group vertical flip");
  await context.command("undo"); await expectElements(horizontal,"one Undo restores the complete mixed group");
  const mirrored=snapshot();
  const loaded=new Promise<void>(resolve=>contents.once("did-finish-load",()=>resolve()));
  contents.reload(); await loaded; await ready(); await count(0);
  assert.deepEqual(snapshot(),mirrored);
  const text=mirrored.elements.find(element=>element.id==="flip-text");
  if (!text || text.tool!=="text") throw new Error("Mirrored text fixture missing");
  await click(framePoint(text.points,10,10)); await count(1);
  await clickButton('[data-selection-delete]');
  await expectElements(mirrored.elements.filter(element=>element.id!==text.id),"mirrored text selection and delete");
  await context.command("undo"); await expectElements(mirrored.elements,"mirrored text delete Undo");
  const beforeStale=snapshot();
  const rejected=await query(`(async()=>{
    const id=crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
    try { return await miniCast.editAnnotationSelection(id,{kind:'flip',axis:'horizontal',ids:['flip-text'],revision:${beforeStale.revision-1}}); }
    finally { miniCast.endAnnotationGesture(id); }
  })()`);
  assert.equal(rejected.accepted,false); assert.equal(rejected.reason,"stale-document");
  assert.deepEqual(snapshot(),beforeStale);
  return { horizontal:true, vertical:true, groupShift:true, undoRedo:true, pixels:true,
    mirroredText:true, delete:true, reload:true, staleRevision:true, emptyDisabled:true };
}
''')
    # Keep test imports minimal: the public axes are exercised through the selection API.
    replace('src/electron/testing/flip-smoke.ts', ', FlipAxis }', ' }')
    replace('src/electron/testing/interaction-smoke.ts', 'import { verifyExistingTextEditing }', 'import { verifySelectionFlip } from "./flip-smoke.js";\nimport { verifyExistingTextEditing }')
    replace('src/electron/testing/interaction-smoke.ts', '''      diagnostics.textEditingTools = await verifyExistingTextEditing({''', '''      diagnostics.flipTools = await verifySelectionFlip({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for flip");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for flip");
          await waitFor(() => context.state().tool === "select", 5000, "flip selection active");
        },
      }, primary.id);
      diagnostics.textEditingTools = await verifyExistingTextEditing({''')
    replace('src/electron/testing/rendering-smoke.ts', '''        elements = []; compare('mixed-clear');''', '''        for (const item of [...shapeSet, textElement, bottom, top]) {
          for (const axis of ['horizontal', 'vertical']) {
            const saved = elements;
            const transformed = resizeAnnotationElement(rotateAnnotationElement(item, {x:45,y:35}, 0.37), {x:30,y:20}, 1.2, 0.8);
            elements = elements.map(element => element.id === item.id ? transformed : element);
            compare('before-flip-' + item.tool + '-' + axis);
            const beforeFlip = elements;
            const flipped = flipAnnotationElement(transformed, {x:45,y:35}, axis);
            elements = elements.map(element => element.id === item.id ? flipped : element);
            compare('flip-' + item.tool + '-' + axis);
            const afterFlip = elements;
            elements = beforeFlip; compare('undo-flip-' + item.tool + '-' + axis);
            elements = afterFlip; compare('redo-flip-' + item.tool + '-' + axis);
            elements = elements.filter(element => element.id !== item.id); compare('erase-flipped-' + item.tool + '-' + axis);
            elements = afterFlip; compare('restore-flipped-' + item.tool + '-' + axis);
            if (flipped.tool === 'text') {
              const measured = createTextElement(a, 'measure-flip', {text:'반전 수정',fontSize:22}, {x:0,y:0}, flipped.color);
              const replacement = replaceAnnotationText(flipped, {text:measured.text,fontSize:measured.fontSize,box:measured.box});
              elements = elements.map(element => element.id === item.id ? replacement : element);
              compare('edit-flipped-text-' + axis);
              elements = afterFlip; compare('undo-edit-flipped-text-' + axis);
            }
            elements = saved; compare('restore-flip-' + item.tool + '-' + axis);
          }
        }
        elements = []; compare('mixed-clear');''')
    replace('scripts/verify-diagnostics.ps1', '  Write-Host "ANNOTATION_CORE_DIAGNOSTICS', '''  foreach ($name in @('horizontal','vertical','groupShift','undoRedo','pixels','mirroredText','delete','reload','staleRevision','emptyDisabled')) {
    if (-not $result.diagnostics.flipTools.$name) { throw "Missing flip verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS''')
    # A preparation failure must never be mistaken for an old successful source run.
    replace('scripts/verify-source.ps1', '$payload.diagnostics.textEditingTools', '$payload.diagnostics.textEditingTools', 1)
    write('scripts/verify-source.ps1', read('scripts/verify-source.ps1') + '''
if (-not $payload.diagnostics.flipTools.horizontal -or -not $payload.diagnostics.flipTools.vertical -or -not $payload.diagnostics.flipTools.groupShift) {
  throw 'Native selection flip coverage was not executed.'
}
''')
    replace('docs/ANNOTATION-TOOLS.md', '현재 문서 기준은 0.8.0입니다.', '현재 문서 기준은 0.9.0입니다.')
    replace('docs/ANNOTATION-TOOLS.md', '반전, 채우기, 레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.', '채우기, 레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.')
    replace('docs/ANNOTATION-TOOLS.md', '## 이력·취소·동기화', '''## 좌우·상하 반전 (0.9.0)

선택 도구로 하나 이상의 객체를 고르고 하단 ‘좌우 반전’ 또는 ‘상하 반전’을 누릅니다. 좌우 반전은 선택 영역 중심의 세로선을, 상하 반전은 가로선을 기준으로 반사합니다. 여러 객체는 각자의 중심이 아니라 그룹 전체의 공통 중심을 사용합니다. 기준선은 실제 문서 경계로 계산하며 화면 안으로 보정된 핸들 위치는 사용하지 않습니다.

문자도 거울에 비친 모양으로 반전합니다. 문자열 자체를 뒤집거나 다른 글자로 바꾸지 않습니다. 색상·선 굵기·투명도·ID·겹침 순서·기존 회전과 기울어짐은 반사 변환 외에는 바꾸지 않습니다. 반전한 텍스트의 내용 수정과 도형의 이동·회전·크기 조절도 계속 가능합니다.

한 번의 반전은 그룹 전체에 대한 Undo 한 번입니다. 좌표가 전혀 바뀌지 않는 점·선 조작은 이력과 Redo를 바꾸지 않습니다. 최신 revision과 대상 객체를 확인한 뒤 그룹 전체를 한 번에 적용하며, 범위를 벗어나거나 오래된 요청은 일부만 적용하지 않습니다. 선택하지 않았거나 다른 편집을 적용 중이면 버튼을 비활성화합니다. 좁은 화면에서는 선택 툴바를 여러 줄로 배치합니다.

## 이력·취소·동기화''')
    write('docs/CHANGELOG.md', read('docs/CHANGELOG.md') + '''

## 0.9.0 — 선택 객체 반전

- 단일·그룹 좌우/상하 반전을 기존 선택 편집·변형 이력·변경분 동기화에 통합합니다.
- 반전된 텍스트의 좌표계·hit test·내용 수정과 회전 후 비균등 확대를 유지합니다.
- 변화 없는 좌표 변형은 이력과 Redo를 보존하고 선택 툴바의 좁은 화면 배치를 보완합니다.
- 반전 기하·stale revision·무작위 지우개·Undo/Redo와 실제 Windows 버튼·Shift 그룹 조작·픽셀 복원·reload 검증을 추가합니다.
''')
    lock = json.loads(read('package-lock.json'))
    assert lock['version'] == '0.8.0' and lock['packages']['']['version'] == '0.8.0'
    lock['version'] = lock['packages']['']['version'] = '0.9.0'
    write('package-lock.json', json.dumps(lock, ensure_ascii=False, indent=2) + '\n')
    subprocess.run(['git', 'add', '--', 'package-lock.json'], check=True)
    package['version'] = '0.9.0'
    package['scripts'].pop('precheck')
    write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    assert 'flipSelectionElements' in read('src/renderer/components/AnnotationSelectionSurface.tsx')
    assert 'diagnostics.flipTools = await verifySelectionFlip' in read('src/electron/testing/interaction-smoke.ts')
    write('.git/hooks/prepare-commit-msg', '#!/bin/sh\nprintf "%s\\n" "feat: add selection mirroring (0.9.0)" > "$1"\n')
    print('FLIP_PREPARATION_COMPLETE version=0.9.0; all unit, native-input, Canvas, package and ZIP checks remain mandatory')
except BaseException:
    failed = json.loads(read('package.json'))
    failed['scripts']['precheck'] = "node -e \"throw new Error('Selection flip preparation failed; publication prohibited')\""
    write('package.json', json.dumps(failed, ensure_ascii=False, indent=2) + '\n')
    raise
