import { clipboard, nativeImage } from "electron";
import { serializeAnnotationFile } from "../../annotation/document-file.js";
import type { AnnotationHistory } from "../../annotation/history.js";
import type { AnnotationState } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsMouseButton, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  state(): AnnotationState;
  publishDocument(displayId: number): void;
  click(selector: string, description: string): Promise<void>;
  checkPassThrough(): Promise<void>;
  refreshDisplays(): Promise<void>;
}

/** Observe real controller buttons, OS input, composed page pixels and unchanged document data. */
export async function verifyAnnotationBoards(context: Context, displayId: number) {
  const controller = mainWindow;
  if (!controller) throw new Error("Board controller is unavailable");
  const target = () => {
    const result = overlayWindows[overlayDisplays.findIndex(display => display.id === displayId)];
    if (!result || result.isDestroyed()) throw new Error("Board overlay is unavailable");
    return result;
  };
  const background = () => target().webContents.executeJavaScript(
    "getComputedStyle(document.querySelector('[data-mini-cast-overlay]')).backgroundColor");
  const ink = () => target().webContents.executeJavaScript("document.querySelector('canvas').toDataURL()");
  async function expectBackground(color: string) {
    await waitFor(async () => await background() === color, 5000, `board background ${color}`);
  }
  async function expectComposedPixel(channel: number) {
    await waitFor(async () => {
      const image = await target().webContents.capturePage({ x: 120, y: 120, width: 1, height: 1 });
      const bytes = image.toBitmap();
      return !image.isEmpty() && bytes.length > 0 && bytes[0] === channel && bytes[1] === channel && bytes[2] === channel && bytes[3] === 255;
    }, 5000, `composed board background pixel ${channel}`);
  }
  const history = context.history;
  history.clearDisplay(displayId);
  history.addElement(displayId, { id: "board-fixture", tool: "rectangle", color: "#EF4444", fill: "#12AB34", width: 2, opacity: 1,
    points: [{ x: 10, y: 10 }, { x: 65, y: 10 }, { x: 10, y: 55 }] });
  history.addElement(displayId, { id: "board-redo", tool: "pen", color: "#000000", width: 2, opacity: 1, points: [{ x: 200, y: 200 }] });
  history.undo();
  context.publishDocument(displayId);
  await injectWindowsShortcut("Alt+Shift+1");
  await waitFor(() => context.state().tool === "pass-through", 5000, "board test starts passive");
  await waitFor(async () => await target().webContents.executeJavaScript(
    "Number(document.querySelector('[data-mini-cast-overlay]').dataset.annotationElements) === 1"), 5000, "board fixture painted");
  const before = JSON.stringify(history.getSnapshot(displayId));
  const fileBefore = serializeAnnotationFile(history.getSnapshot(displayId));
  const pixelsBefore = await ink();
  await context.click('[data-board-mode="white"]', "actual whiteboard button");
  await expectBackground("rgb(255, 255, 255)");
  if (context.state().tool !== "pen") throw new Error("Whiteboard from pass-through did not enter pen mode");
  await expectComposedPixel(255);

  const bounds = target().getBounds();
  await injectWindowsMouseButton(bounds.x + 160, bounds.y + 120, true);
  await waitFor(async () => await target().webContents.executeJavaScript(
    "Boolean(document.querySelector('canvas[data-active-gesture=true]'))"), 5000, "real whiteboard pointer capture");
  try {
    const changed = await controller.webContents.executeJavaScript(
      `miniCast.setAnnotationBoard({displayId:${displayId},mode:'black'})`);
    if (!changed.accepted) throw new Error("Board switch during input was not accepted");
  } finally { await injectWindowsMouseButton(bounds.x + 160, bounds.y + 120, false); }
  await expectBackground("rgb(0, 0, 0)");
  await expectComposedPixel(0);
  if (JSON.stringify(history.getSnapshot(displayId)) !== before || !history.canRedo || await ink() !== pixelsBefore)
    throw new Error("Board change committed unfinished input or altered ink/history");
  if (serializeAnnotationFile(history.getSnapshot(displayId)) !== fileBefore)
    throw new Error("Presentation backgrounds leaked into editable document data");

  const forbidden = await target().webContents.executeJavaScript(
    `miniCast.setAnnotationBoard({displayId:${displayId},mode:'white'})`);
  if (forbidden.accepted || forbidden.reason !== "invalid-request") throw new Error("Overlay could change board configuration");
  const noOp = await controller.webContents.executeJavaScript(
    `miniCast.setAnnotationBoard({displayId:${displayId},mode:'black'})`);
  if (!noOp.accepted || noOp.changed) throw new Error("Same board mode created a new state revision");

  await injectWindowsShortcut("Escape");
  await expectBackground("rgba(0, 0, 0, 0)");
  await context.checkPassThrough();
  await injectWindowsShortcut("Alt+Shift+3");
  await expectBackground("rgb(0, 0, 0)");
  await context.click('[data-board-mode="white"]', "switch from blackboard to whiteboard");
  await expectBackground("rgb(255, 255, 255)");

  // A background is not a raster element: the existing image-copy command must remain transparent.
  await context.click('[data-export-action="clipboard"]', "copy ink while whiteboard is visible");
  await waitFor(async () => await controller.webContents.executeJavaScript(
    "document.querySelector('[data-export-status]').dataset.exportStatus === 'copied'"), 5000, "board ink PNG copied");
  const item = (await clipboard.read()).find(value => value.types.includes("image/png"));
  const payload = item ? await item.getType("image/png") : null;
  if (!(payload instanceof Blob)) throw new Error("Missing board PNG clipboard image");
  const image = nativeImage.createFromBuffer(Buffer.from(await payload.arrayBuffer()));
  const size = image.getSize();
  const bytes = image.toBitmap();
  const x = Math.floor(120 * size.width / bounds.width), y = Math.floor(120 * size.height / bounds.height);
  if (bytes[4 * (y * size.width + x) + 3] !== 0) throw new Error("Whiteboard background leaked into transparent PNG");

  controller.webContents.reload();
  await waitFor(async () => !controller.webContents.isLoading() && await controller.webContents.executeJavaScript(
    "Boolean(document.querySelector('[data-mini-cast-tab=annotation]'))"), 5000, "controller reload");
  await context.click('[data-mini-cast-tab="annotation"]', "board tab after controller reload");
  await waitFor(async () => await controller.webContents.executeJavaScript(
    "document.querySelector('[data-board-mode=white]')?.getAttribute('aria-pressed') === 'true'"), 5000, "controller board state restored");
  target().webContents.reload();
  await waitFor(async () => !target().webContents.isLoading() && await target().webContents.executeJavaScript(
    "Boolean(document.querySelector('[data-mini-cast-overlay]'))"), 5000, "board renderer reload");
  await expectBackground("rgb(255, 255, 255)");
  await context.refreshDisplays();
  await expectBackground("rgb(255, 255, 255)");
  if (JSON.stringify(history.getSnapshot(displayId)) !== before || !history.canRedo || await ink() !== pixelsBefore)
    throw new Error("Board recovery lost the document or its Redo history");
  await context.click('[data-board-mode="transparent"]', "restore screen annotation background");
  await expectBackground("rgba(0, 0, 0, 0.004)");
  return { white: true, black: true, composedPixels: true, cancelledInput: true, historyIsolated: true,
    fileIsolated: true, pngTransparent: true, senderRejected: true, noOp: true,
    escapeRouting: true, reentry: true, controllerReload: true, overlayReload: true, displayRebuild: true };
}
