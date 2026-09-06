import { app, globalShortcut } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnnotationHistory } from "../../annotation/history.js";
import type { AnnotationSaveState } from "../annotation-save-state.js";
import { isTrayReady } from "../tray.js";
import { mainWindow, quitApplication, showMainWindow, hideMainWindow, isOverlayInteractive } from "../window.js";
import { nativeDialog } from "./document-file-smoke.js";
import { injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  saved: AnnotationSaveState;
  quitWaiting(): boolean;
  publishDocument(displayId: number): void;
}

export async function verifyUnsavedQuit(context: Context, displayId: number) {
  const controller = mainWindow;
  if (!controller) throw new Error("Missing controller for unsaved quit check");
  context.history.addElement(displayId, { id: "unsaved-quit-marker", tool: "pen", color: "#123456",
    width: 4, opacity: 1, points: [{ x: 60, y: 60 }, { x: 95, y: 85 }] });
  context.publishDocument(displayId);
  const original = context.history.getSnapshot(displayId);
  if (!context.saved.isDirty(original)) throw new Error("Unsaved fixture was incorrectly clean");
  const exported = await controller.webContents.executeJavaScript(`miniCast.exportAnnotation({displayId:${displayId},destination:'clipboard'})`);
  if (exported.status !== "copied" || !context.saved.isDirty(original)) throw new Error("PNG copy incorrectly marked editable work as saved");
  for (const cancel of ["Enter", "Escape"]) {
    quitApplication();
    await nativeDialog("저장하지 않은 판서");
    quitApplication(); // A repeated tray exit must not open a second prompt or tear down resources.
    if (!context.quitWaiting() || !isTrayReady() || controller.isDestroyed())
      throw new Error("Unsaved confirmation did not preserve the running app");
    if (globalShortcut.isRegistered("Escape")) throw new Error("Global Escape steals native dialog cancellation");
    await injectWindowsShortcut(cancel);
    await waitFor(() => !context.quitWaiting(), 5000, "native unsaved quit cancellation");
    if (context.history.getSnapshot(displayId) !== original || !isTrayReady() || controller.isDestroyed())
      throw new Error("Cancelled quit changed the document or destroyed controls");
  }
  for (const transition of ["hide", "minimize"]) {
    await injectWindowsShortcut("Alt+Shift+3");
    await waitFor(() => isOverlayInteractive(), 5000, "pen active before quit visibility boundary");
    quitApplication(); await nativeDialog("저장하지 않은 판서");
    const effectiveTool = await controller.webContents.executeJavaScript("miniCast.getAnnotationState().then(state => state.tool)");
    if (isOverlayInteractive() || effectiveTool !== "pass-through") throw new Error("Quit prompt did not suspend board and pointer input");
    if (transition === "hide") hideMainWindow(); else controller.minimize();
    await waitFor(() => !context.quitWaiting(), 5000, "hidden or minimized quit prompt is cancelled");
    if (isOverlayInteractive() || context.history.getSnapshot(displayId) !== original) throw new Error("Hidden controller restored blocking input or lost unsaved work");
    showMainWindow();
    if (isOverlayInteractive()) throw new Error("Showing controller resurrected blocked annotation input");
  }
  await injectWindowsShortcut("Alt+Shift+3");
  await injectWindowsShortcut("Alt+Shift+1");
  return { hiddenCancel: true, minimizedCancel: true, presentationSuspended: true, pngNotSaved: true, defaultCancel: true, escapeCancel: true, repeatedQuit: true, documentPreserved: true };
}

/** The parent verifies this marker AND normal process exit; no bypass of the product quit guard. */
export async function acceptUnsavedSmokeQuit() {
  await nativeDialog("저장하지 않은 판서");
  await injectWindowsShortcut("Right");
  await writeFile(path.join(app.getPath("userData"), "quit-discard.txt"), "confirmed", "utf8");
  await injectWindowsShortcut("Enter");
}
