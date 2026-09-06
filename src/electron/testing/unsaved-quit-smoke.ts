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
  for (const transition of ["hide", "reload"]) {
    await injectWindowsShortcut("Alt+Shift+3");
    await waitFor(() => isOverlayInteractive(), 5000, "pen active before quit visibility boundary");
    quitApplication(); await nativeDialog("저장하지 않은 판서");
    const effectiveTool = await controller.webContents.executeJavaScript("miniCast.getAnnotationState().then(state => state.tool)");
    if (isOverlayInteractive() || effectiveTool !== "pass-through") throw new Error("Quit prompt did not suspend board and pointer input");
    if (transition === "hide") {
      hideMainWindow();
    } else {
      controller.webContents.reload();
    }
    await waitFor(() => !context.quitWaiting(), 5000, `${transition} cancels the native quit prompt`);
    if (isOverlayInteractive() || context.history.getSnapshot(displayId) !== original)
      throw new Error(`${transition} restored blocking input or lost unsaved work`);
    if (transition === "reload") {
      await waitFor(() => !controller.webContents.isLoadingMainFrame(), 5000, "controller reload completes after quit cancellation");
      await controller.webContents.executeJavaScript("miniCast.getAnnotationState()");
    }
    showMainWindow();
    if (isOverlayInteractive()) throw new Error("Showing controller resurrected blocked annotation input");
  }
  // A Windows native modal disables its parent. Calling minimize() is a
  // no-op, not a minimize event; verify the prompt remains usable and safe.
  await injectWindowsShortcut("Alt+Shift+3");
  await waitFor(() => isOverlayInteractive(), 5000, "pen active before modal minimize attempt");
  quitApplication(); await nativeDialog("저장하지 않은 판서");
  if (controller.isEnabled()) throw new Error("Native quit prompt did not disable its parent");
  controller.minimize();
  await new Promise(resolve => setTimeout(resolve, 150));
  if (controller.isMinimized() || !context.quitWaiting() || isOverlayInteractive() ||
      context.history.getSnapshot(displayId) !== original)
    throw new Error("Blocked native parent minimization changed quit state, input or document");
  await nativeDialog("저장하지 않은 판서");
  await injectWindowsShortcut("Escape");
  await waitFor(() => !context.quitWaiting() && controller.isEnabled(), 5000, "modal cancellation re-enables the controller");
  controller.minimize();
  await waitFor(() => controller.isMinimized() && !isOverlayInteractive(), 5000, "actual minimization after modal cancellation returns to pass-through");
  showMainWindow();
  if (isOverlayInteractive() || context.history.getSnapshot(displayId) !== original)
    throw new Error("Restoring a minimized controller resurrected input or changed unsaved work");
  await injectWindowsShortcut("Alt+Shift+3");
  await injectWindowsShortcut("Alt+Shift+1");
  return { hiddenCancel: true, reloadCancel: true, blockedMinimize: true, minimizedAfterCancel: true, presentationSuspended: true, pngNotSaved: true, defaultCancel: true, escapeCancel: true, repeatedQuit: true, documentPreserved: true };
}

/** The parent verifies this marker AND normal process exit; no bypass of the product quit guard. */
export async function acceptUnsavedSmokeQuit() {
  await nativeDialog("저장하지 않은 판서");
  await injectWindowsShortcut("Right");
  await writeFile(path.join(app.getPath("userData"), "quit-discard.txt"), "confirmed", "utf8");
  await injectWindowsShortcut("Enter");
}
