import assert from "node:assert/strict";
import { screen } from "electron";
import type { AnnotationHistory, AnnotationElement } from "../../annotation/history.js";
import { annotationSelectionBounds, resizeSelectionElements } from "../../annotation/selection.js";
import { resizeHandlePoint, type ResizeHandle } from "../../annotation/resize.js";
import type { AnnotationCommand, AnnotationState } from "../../shared/contract.js";
import { overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface ResizeSmokeContext {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  state(): AnnotationState;
}

/** Native pointer/keyboard input drives the production handles. Direct history
 * access is used only to prepare fixtures and observe authoritative results.
 */
export async function verifySelectionResize(context: ResizeSmokeContext, displayId: number) {
  const { history } = context;
  const target = overlayWindows[overlayDisplays.findIndex(display => display.id === displayId)];
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!target || !display || context.state().tool !== "select") throw new Error("Missing selection resize test surface");
  const query = (source: string) => target.webContents.executeJavaScript(source);
  const screenPoint = (point: { x: number; y: number }) => ({
    x: Math.round(display.bounds.x + point.x), y: Math.round(display.bounds.y + point.y),
  });
  const snapshot = () => history.getSnapshot(displayId);
  const ready = async () => {
    await waitFor(async () => {
      const state = await query(`(() => ({
        revision: Number(document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision),
        busy: document.querySelector('[data-annotation-selection-busy]')?.dataset.annotationSelectionBusy
      }))()`);
      return state.revision === snapshot().revision && state.busy === "false";
    }, 5000, "resize transaction and renderer settle");
  };
  const selectedCount = async (count: number) => {
    await waitFor(async () => Number(await query(`document.querySelector('[data-annotation-selection-count]')?.dataset.annotationSelectionCount`)) === count,
      5000, `${count} native resize selections`);
  };
  const handlePoint = async (handle: ResizeHandle, ids: readonly string[]) => {
    const bounds = annotationSelectionBounds(snapshot().elements, new Set(ids));
    if (!bounds) throw new Error("Missing resize bounds");
    const expected = resizeHandlePoint(bounds, handle);
    await waitFor(async () => {
      const point = await query(`(() => {
        const node = document.querySelector('[data-selection-resize-handle="${handle}"]');
        if (!node || node.disabled) return null;
        const r = node.getBoundingClientRect();
        return { x:r.left+r.width/2, y:r.top+r.height/2 };
      })()`);
      return point !== null && Math.abs(point.x - expected.x) < 0.1 && Math.abs(point.y - expected.y) < 0.1;
    }, 5000, "current resize handle position");
    return screenPoint(expected);
  };
  const expectElements = async (expected: readonly AnnotationElement[], label: string) => {
    await waitFor(() => JSON.stringify(snapshot().elements) === JSON.stringify(expected), 5000, label);
    await ready();
  };

  history.clearDisplay(displayId);
  history.addElement(displayId, { id: "resize-rectangle", tool: "rectangle", color: "#007AFF", width: 4, opacity: 1,
    points: [{ x: 100, y: 100 }, { x: 240, y: 180 }] });
  history.addElement(displayId, { id: "resize-text", tool: "text", color: "#123456", opacity: 1,
    points: [{ x: 310, y: 135 }], text: "크기 조절", fontSize: 24, scaleX: 1, scaleY: 1,
    box: { minX: 0, minY: 0, maxX: 120, maxY: 32 } });
  context.publishDocument(displayId);
  await ready();
  const click = screenPoint({ x: 170, y: 100 });
  await injectWindowsClick(click.x, click.y); await selectedCount(1);
  const original = snapshot();
  const firstHandle = await handlePoint("se", ["resize-rectangle"]);
  await injectWindowsClick(firstHandle.x, firstHandle.y);
  await ready();
  assert.equal(snapshot().revision, original.revision, "A handle click created history");

  const delta = { x: 40, y: 20 };
  const expected = resizeSelectionElements(original.elements, new Set(["resize-rectangle"]), "se", delta.x, delta.y, false);
  await injectWindowsDrag(firstHandle.x, firstHandle.y, firstHandle.x + delta.x, firstHandle.y + delta.y);
  await expectElements(expected, "native corner resize commits exact geometry");
  assert.equal(snapshot().revision, original.revision + 1, "Resize was not one transaction");
  // A pixel on the newly resized right edge must exist in the committed Canvas.
  const rectangle = snapshot().elements[0];
  const edge = { x: rectangle.points[1].x, y: (rectangle.points[0].y + rectangle.points[1].y) / 2 };
  await waitFor(async () => await query(`(() => {
    const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d');
    return ctx.getImageData(Math.round(${edge.x}*canvas.width/canvas.clientWidth),
      Math.round(${edge.y}*canvas.height/canvas.clientHeight),1,1).data[3] > 0;
  })()`), 5000, "resized outline pixels");
  await context.command("undo"); await expectElements(original.elements, "one native Undo restores resize");
  await context.command("redo"); await expectElements(expected, "native Redo restores resize");

  // Shift-click with an actual held Shift key, then Shift-drag the whole group.
  const textPoint = screenPoint({ x: 360, y: 150 });
  await injectWindowsDrag(textPoint.x, textPoint.y, textPoint.x, textPoint.y, ["Shift"]);
  await selectedCount(2);
  const groupBefore = snapshot();
  const groupIds = ["resize-rectangle", "resize-text"];
  const groupHandle = await handlePoint("nw", groupIds);
  const groupExpected = resizeSelectionElements(groupBefore.elements, new Set(groupIds), "nw", -24, -17, true);
  await injectWindowsDrag(groupHandle.x, groupHandle.y, groupHandle.x - 24, groupHandle.y - 17, ["Shift"]);
  await expectElements(groupExpected, "native Shift-drag resizes a mixed group");
  const resizedText = snapshot().elements.find(element => element.tool === "text");
  if (!resizedText || resizedText.tool !== "text") throw new Error("Resized text is missing");
  assert.equal(resizedText.scaleX, resizedText.scaleY, "Shift did not preserve text aspect");
  await context.command("undo"); await expectElements(groupBefore.elements, "one Undo restores both group members");
  await context.command("redo"); await expectElements(groupExpected, "group resize Redo");

  const beforeCancel = snapshot();
  const cancelHandle = await handlePoint("se", groupIds);
  await query(`(() => { const c = document.querySelector('canvas');
    window.__miniCastResizePixels = c.getContext('2d').getImageData(0,0,c.width,c.height).data; })()`);
  try {
    await injectWindowsMouseButton(cancelHandle.x, cancelHandle.y, true);
    await injectWindowsMouseMove(cancelHandle.x + 18, cancelHandle.y + 14);
    await waitFor(async () => await query(`Boolean(document.querySelector('[data-active-gesture="resize"]'))`), 5000, "held resize starts");
    await context.command("undo");
    await waitFor(async () => !(await query(`Boolean(document.querySelector('[data-active-gesture]'))`)), 5000, "held resize cancels");
    assert.equal(snapshot().revision, beforeCancel.revision, "Held resize Undo touched committed history");
    await waitFor(async () => await query(`(() => {
      const c = document.querySelector('canvas'); const a = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const b = window.__miniCastResizePixels;
      return a.length === b.length && a.every((v,i) => v === b[i]);
    })()`), 5000, "held resize cancellation restores exact committed pixels");
  } finally {
    await injectWindowsMouseButton(cancelHandle.x + 18, cancelHandle.y + 14, false);
    await query("delete window.__miniCastResizePixels");
  }

  // An external revision invalidates the complete pending resize, not one member.
  const staleHandle = await handlePoint("se", groupIds);
  const staleRevision = snapshot().revision;
  try {
    await injectWindowsMouseButton(staleHandle.x, staleHandle.y, true);
    await injectWindowsMouseMove(staleHandle.x + 12, staleHandle.y + 12);
    await waitFor(async () => await query(`Boolean(document.querySelector('[data-active-gesture="resize"]'))`), 5000, "resize before external revision");
    history.translateElements(displayId, ["resize-text"], 2, 0);
    context.publishDocument(displayId);
    await waitFor(async () => !(await query(`Boolean(document.querySelector('[data-active-gesture]'))`)), 5000, "external revision cancels resize");
  } finally {
    await injectWindowsMouseButton(staleHandle.x + 12, staleHandle.y + 12, false);
  }
  await ready();
  const afterExternal = snapshot();
  const rejected = await query(`(async () => {
    const id = crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
    try { return await miniCast.editAnnotationSelection(id, {
      kind:'resize', revision:${staleRevision}, ids:['resize-rectangle','resize-text'],
      handle:'se', dx:12, dy:12, lockAspect:false
    }); } finally { miniCast.endAnnotationGesture(id); }
  })()`);
  assert.equal(rejected.accepted, false); assert.equal(rejected.reason, "stale-document");
  assert.deepEqual(snapshot(), afterExternal);

  // Reload while the handle is held must discard the preview and the selection.
  const reloadHandle = await handlePoint("se", groupIds);
  try {
    await injectWindowsMouseButton(reloadHandle.x, reloadHandle.y, true);
    await injectWindowsMouseMove(reloadHandle.x + 10, reloadHandle.y + 10);
    await waitFor(async () => await query(`Boolean(document.querySelector('[data-active-gesture="resize"]'))`), 5000, "resize before reload");
    const loaded = new Promise<void>(resolve => target.webContents.once("did-finish-load", () => resolve()));
    target.webContents.reload(); await loaded;
  } finally {
    await injectWindowsMouseButton(reloadHandle.x + 10, reloadHandle.y + 10, false);
  }
  await ready(); await selectedCount(0);
  assert.deepEqual(snapshot(), afterExternal);
  assert.equal(await query(`document.querySelectorAll('[data-selection-resize-handle]').length`), 0);

  const restoredRectangle = snapshot().elements[0];
  const reclick = screenPoint({ x: (restoredRectangle.points[0].x + restoredRectangle.points[1].x) / 2,
    y: restoredRectangle.points[0].y });
  await injectWindowsClick(reclick.x, reclick.y); await selectedCount(1);
  const escapeHandle = await handlePoint("se", ["resize-rectangle"]);
  try {
    await injectWindowsMouseButton(escapeHandle.x, escapeHandle.y, true);
    await injectWindowsMouseMove(escapeHandle.x + 15, escapeHandle.y + 15);
    await injectWindowsShortcut("Escape");
    await waitFor(() => context.state().tool === "pass-through", 5000, "Escape leaves held resize");
  } finally {
    await injectWindowsMouseButton(escapeHandle.x + 15, escapeHandle.y + 15, false);
  }
  assert.deepEqual(snapshot(), afterExternal);
  return { handles: true, noOp: true, resize: true, undoRedo: true, groupShift: true,
    pixels: true, heldUndo: true, staleRevision: true, activeReload: true, heldEscape: true };
}
