import { clipboard, screen } from "electron";
import { mkdir } from "node:fs/promises";
import { app } from "electron";
import path from "node:path";
import type { AnnotationHistory } from "../../annotation/history.js";
import { serializeAnnotationFile } from "../../annotation/document-file.js";
import type { AnnotationState } from "../../shared/contract.js";
import type { AnnotationIoGate } from "../annotation-io-gate.js";
import { saveAnnotationFile } from "../annotation-file-store.js";
import { isTrayReady } from "../tray.js";
import { mainWindow, overlayDisplays, overlayWindows, quitApplication, showMainWindow } from "../window.js";
import { nativeDialog } from "./document-file-smoke.js";
import { injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  gate: AnnotationIoGate;
  quitWaiting(): boolean;
  state(): AnnotationState;
  click(selector: string, label: string): Promise<void>;
}

export async function verifyIntegrationBoundaries(context: Context, displayId: number) {
  const controller = mainWindow;
  const target = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!controller || !target || !display) throw new Error("Missing boundary-test windows");
  const query = (source: string) => target.webContents.executeJavaScript(source);
  const ready = async () => {
    await waitFor(async () => Number(await query("document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision")) ===
      context.history.getSnapshot(displayId).revision, 5000, "boundary document reaches renderer");
    await query("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  };
  const originalBounds = controller.getBounds();
  const zoom = target.webContents.getZoomFactor();
  const x = display.workArea.x + 40, y = display.workArea.y + 40;
  const original = context.history.getSnapshot(displayId);
  const pixels = () => query("document.querySelector('canvas').toDataURL()");
  const checkedTools: string[] = [];
  try {
    controller.setPosition(display.workArea.x + display.workArea.width - originalBounds.width - 10, display.workArea.y + 10);
    target.webContents.setZoomFactor(1);
    await ready();
    for (const tool of ["pen", "highlighter", "line", "eraser"] as const) {
      await context.click(`[data-annotation-tool="${tool}"]`, "held viewport tool");
      await waitFor(() => context.state().tool === tool, 5000, "held viewport tool selected");
      await ready();
      const beforePixels = await pixels();
      await injectWindowsMouseMove(x, y);
      await injectWindowsMouseButton(x, y, true);
      await injectWindowsMouseMove(x + 30, y + 20);
      await waitFor(async () => Boolean(await query("Boolean(document.querySelector('canvas[data-active-gesture]'))")), 5000, "native held input exists");
      target.webContents.setZoomFactor(1.25);
      await waitFor(async () => !(await query("Boolean(document.querySelector('canvas[data-active-gesture]'))")), 5000, "CSS/DPR change cancels held input");
      await injectWindowsMouseButton(x + 30, y + 20, false);
      target.webContents.setZoomFactor(1);
      await ready();
      if (context.history.getSnapshot(displayId) !== original || await pixels() !== beforePixels)
        throw new Error("Viewport cancellation committed stale geometry or failed to restore ink");
      checkedTools.push(tool);
    }
    await context.click('[data-annotation-tool="pen"]', "redundant resize observer fixture");
    await waitFor(() => context.state().tool === "pen", 5000, "pen for redundant resize");
    await injectWindowsMouseMove(x, y); await injectWindowsMouseButton(x, y, true);
    await waitFor(async () => Boolean(await query("Boolean(document.querySelector('canvas[data-active-gesture]'))")), 5000, "held pen for redundant event");
    await query("window.dispatchEvent(new Event('resize')); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    if (!(await query("Boolean(document.querySelector('canvas[data-active-gesture]'))"))) throw new Error("Unchanged resize notification cancelled a valid stroke");
    await injectWindowsMouseButton(x + 30, y + 20, false);
    await waitFor(() => context.history.getSnapshot(displayId).elements.length === original.elements.length + 1, 5000, "unchanged-size input still commits");
    await injectWindowsShortcut("CommandOrControl+Z");
    await ready();
    if (JSON.stringify(context.history.getSnapshot(displayId).elements) !== JSON.stringify(original.elements)) throw new Error("Boundary fixture Undo lost the original document");

    await waitFor(() => context.state().tool === "pen", 5000, "pen for gesture authorization");
    const authorizationRevision = context.history.getSnapshot(displayId).revision;
    const authorization = await query(`(async () => {
      const wrongAddId = crypto.randomUUID();
      miniCast.beginAnnotationGesture(wrongAddId);
      const wrongAdd = await miniCast.commitAnnotationElement(wrongAddId, {
        id: 'boundary-wrong-highlighter', tool: 'highlighter', color: '#FF0000', width: 18,
        opacity: 0.35, points: [{x:40,y:40},{x:80,y:60}]
      });
      miniCast.endAnnotationGesture(wrongAddId);
      const wrongRemoveId = crypto.randomUUID();
      miniCast.beginAnnotationGesture(wrongRemoveId);
      const wrongRemove = await miniCast.removeAnnotationElements(wrongRemoveId, ['boundary-missing']);
      miniCast.endAnnotationGesture(wrongRemoveId);
      return { wrongAdd, wrongRemove };
    })()`);
    if (authorization.wrongAdd?.accepted || authorization.wrongAdd?.reason !== "stale-gesture" ||
        authorization.wrongRemove?.accepted || authorization.wrongRemove?.reason !== "stale-gesture")
      throw new Error("Permanent gesture lease accepted a mutation from the wrong tool");
    if (context.history.getSnapshot(displayId).revision !== authorizationRevision)
      throw new Error("Rejected cross-tool mutation changed the authoritative document");

    await injectWindowsShortcut("Alt+Shift+1");
    await waitFor(() => context.state().tool === "pass-through", 5000, "passive export boundary");
    for (const transition of ["hide", "minimize"] as const) {
      showMainWindow();
      await clipboard.writeText("MiniCast boundary clipboard sentinel");
      await query(`(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        window.__boundaryRelease = null;
        window.__boundaryRestore = () => { HTMLCanvasElement.prototype.toBlob = original; };
        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
          const canvas = this;
          window.__boundaryRelease = () => original.call(canvas, callback, type, quality);
        };
      })()`);
      try {
        const resultPromise = controller.webContents.executeJavaScript(`miniCast.exportAnnotation({displayId:${displayId},destination:'clipboard'})`);
        await waitFor(async () => Boolean(await query("Boolean(window.__boundaryRelease)")), 5000, "PNG generation deliberately held before publication");
        if (transition === "hide") controller.hide(); else controller.minimize();
        showMainWindow();
        const result = await resultPromise;
        if (result.status !== "error" || result.reason !== "unavailable") throw new Error("A hidden/restored owner retained a stale export");
        await query("window.__boundaryRestore(); window.__boundaryRelease();");
        await query("new Promise(resolve => setTimeout(resolve, 150))");
        if (await clipboard.readText() !== "MiniCast boundary clipboard sentinel") throw new Error("Invalidated export overwrote the clipboard");
      } finally {
        await query("window.__boundaryRestore?.(); delete window.__boundaryRestore; delete window.__boundaryRelease;");
      }
    }
    // Exercise the real tray quit entrypoint and a real failing atomic file write.
    const stable = context.history.getSnapshot(displayId);
    const blocked = path.join(app.getPath("userData"), "blocked-quit.minicast");
    await mkdir(blocked);
    const release = context.gate.acquire();
    if (!release) throw new Error("I/O gate remained busy after invalidated export");
    const publication = context.gate.publish(() => saveAnnotationFile(blocked, serializeAnnotationFile(stable)));
    const handled = publication.then(() => null, error => error).finally(release);
    quitApplication();
    if (!context.quitWaiting() || !isTrayReady() || controller.isDestroyed()) throw new Error("Quit cleaned resources before the write settled");
    if (!(await handled)) throw new Error("Expected the directory-backed atomic write to fail");
    await nativeDialog("저장 실패로 종료 취소");
    await injectWindowsShortcut("Escape");
    if (!isTrayReady() || controller.isDestroyed() || context.quitWaiting() || context.history.getSnapshot(displayId) !== stable)
      throw new Error("Failed-write quit did not retain a usable document and tray");
    await injectWindowsShortcut("Alt+Shift+3");
    await waitFor(() => context.state().tool === "pen", 5000, "real tool shortcut remains alive after failed quit");
    await injectWindowsShortcut("Alt+Shift+1");
    return { heldViewport: checkedTools, redundantResize: true, gestureAuthorization: true,
      hiddenExport: true, minimizedExport: true, lateReplyIgnored: true,
      failedWriteCancelsQuit: true, trayAndShortcutsSurvive: true };
  } finally {
    await injectWindowsMouseButton(x + 30, y + 20, false);
    target.webContents.setZoomFactor(zoom);
    controller.setBounds(originalBounds);
  }
}
