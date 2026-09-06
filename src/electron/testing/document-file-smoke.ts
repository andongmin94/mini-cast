import type { AnnotationSaveState } from "../annotation-save-state.js";
import { app, clipboard } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAnnotationFile } from "../../annotation/document-file.js";
import type { AnnotationHistory, AnnotationElement } from "../../annotation/history.js";
import type { AnnotationCommand } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  saved: AnnotationSaveState;
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  click(selector: string, label: string): Promise<void>;
  command(command: AnnotationCommand): Promise<void>;
}
export async function nativeDialog(title: string) {
  // Titles below are fixed test constants, never a path or renderer-provided value.
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DocumentDialog {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
for ($i=0; $i -lt 100; $i++) {
 $h=[DocumentDialog]::FindWindow("#32770", "${title}")
 if ($h -ne [IntPtr]::Zero) { [DocumentDialog]::SetForegroundWindow($h) | Out-Null; exit 0 }
 Start-Sleep -Milliseconds 50
}
throw "Document dialog not found: ${title}"
`], { windowsHide: true, timeout: 10_000 });
}
async function choosePath(file: string) {
  await clipboard.writeText(file);
  for (const key of ["Alt+N", "Control+A", "Control+V", "Enter"]) await injectWindowsShortcut(key);
}
export async function verifyAnnotationFiles(context: Context, displayId: number) {
  const controller = mainWindow;
  const target = overlayWindows[overlayDisplays.findIndex(display => display.id === displayId)];
  if (!controller || !target) throw new Error("Missing document-file windows");
  const history = context.history;
  const directory = path.join(app.getPath("userData"), "editable-file-check");
  await mkdir(directory, { recursive: true });
  const status = () => controller.webContents.executeJavaScript("document.querySelector('[data-file-status]')?.getAttribute('data-file-status')");
  const reason = () => controller.webContents.executeJavaScript("document.querySelector('[data-file-status]')?.getAttribute('data-file-reason')");
  const changed = () => context.publishDocument(displayId);
  const elements = () => JSON.stringify(history.getSnapshot(displayId).elements);
  const ready = () => waitFor(async () => Number(await target.webContents.executeJavaScript("document.querySelector('[data-mini-cast-overlay]')?.getAttribute('data-annotation-revision')")) === history.getSnapshot(displayId).revision, 5000, "file document rendered");
  const pixels = async () => {
    await ready();
    return target.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('canvas').toDataURL()))))`);
  };
  const invoke = (action: "save" | "open") => controller.webContents.executeJavaScript(`miniCast.annotationFile({displayId:${displayId},action:'${action}'})`);
  const save = () => context.click('[data-file-action="save"]', "native editable-file save button");
  const open = () => context.click('[data-file-action="open"]', "native editable-file open button");
  await context.click('[data-mini-cast-tab="annotation"]', "editable-file tab");
  history.clearDisplay(displayId);
  const text = await target.webContents.executeJavaScript(`(() => {
    const c=document.createElement('canvas').getContext('2d'); c.font='400 20px "Pretendard"';
    return {id:'file-text',tool:'text',text:'한글 ABC',fontSize:20,color:'#112233',opacity:1,
      box:{minX:-2,minY:0,maxX:120,maxY:30},points:[{x:150,y:80},{x:149,y:80},{x:150,y:81}]};
  })()`) as AnnotationElement;
  const fixture: AnnotationElement[] = [
    { id: "file-box", tool: "rectangle", color: "#123456", fill: "#44BB66", width: 4, opacity: 1,
      points: [{ x: 15, y: 15 }, { x: 80, y: 25 }, { x: 10, y: 60 }] },
    { id: "file-marker", tool: "highlighter", color: "#FFD60A", width: 12, opacity: 0.35,
      points: [{ x: 20, y: 100 }, { x: 180, y: 120 }] }, text,
  ];
  for (const element of fixture) history.addElement(displayId, element);
  changed();
  // Saving switches to passive and excludes selection chrome; save is snapshot-pinned.
  const filePath = path.join(directory, "한글 판서.minicast");
  const original = history.getSnapshot(displayId), originalElements = elements();
  await save(); await nativeDialog("판서 파일 저장");
  const imageOverlap = await controller.webContents.executeJavaScript(`miniCast.exportAnnotation({displayId:${displayId},destination:'clipboard'})`);
  if (imageOverlap.reason !== "busy" || (await invoke("open")).reason !== "busy") throw new Error("Native file and image operations did not share a gate");
  history.addElement(displayId, { id: "later", tool: "pen", color: "#000000", width: 8, opacity: 1, points: [{ x: 240, y: 50 }] }); changed();
  await choosePath(filePath); await waitFor(async () => await status() === "saved", 7000, "editable file saved");
  const file = parseAnnotationFile(await readFile(filePath, "utf8"));
  if (JSON.stringify(file.elements) !== originalElements || history.getSnapshot(displayId).elements.length !== original.elements.length + 1)
    throw new Error("Editable save did not pin content or changed the live document");
  if (!context.saved.isDirty(history.getSnapshot(displayId))) throw new Error("Pinned save marked newer edits as saved");
  const beforeOpen = history.getSnapshot(displayId), beforePixels = await pixels();
  await open(); await nativeDialog("판서 파일 열기"); await choosePath(filePath); await nativeDialog("판서 교체 확인");
  await injectWindowsShortcut("Right"); await injectWindowsShortcut("Enter");
  await waitFor(async () => await status() === "opened", 7000, "editable file opened");
  if (elements() !== originalElements) throw new Error("Open did not restore exact editable geometry");
  if (context.saved.isDirty(history.getSnapshot(displayId))) throw new Error("Opened file was not a clean baseline");
  const openedPixels = await pixels();
  if (openedPixels === beforePixels) throw new Error("Open did not repaint the removed extra object");
  await context.click('[data-annotation-tool="pen"]', "pen for native file Undo");
  await context.command("undo");
  if (elements() !== JSON.stringify(beforeOpen.elements) || await pixels() !== beforePixels) throw new Error("One Undo did not restore the replaced document and pixels");
  if (!context.saved.isDirty(history.getSnapshot(displayId))) throw new Error("Undo of file open lost dirty state");
  await context.command("redo");
  if (elements() !== originalElements || await pixels() !== openedPixels) throw new Error("Redo did not restore loaded objects and pixels");
  if (context.saved.isDirty(history.getSnapshot(displayId))) throw new Error("Redo of file open did not restore saved contents");
  const stable = history.getSnapshot(displayId);
  await save(); await nativeDialog("판서 파일 저장"); await injectWindowsShortcut("Escape");
  await waitFor(async () => await status() === "cancelled", 5000, "editable save cancelled");
  if (history.getSnapshot(displayId) !== stable) throw new Error("Cancelling save changed the document");
  await open(); await nativeDialog("판서 파일 열기"); await choosePath(filePath); await nativeDialog("판서 교체 확인");
  await injectWindowsShortcut("Escape");
  await waitFor(async () => await status() === "cancelled", 5000, "replacement confirmation cancelled");
  if (history.getSnapshot(displayId) !== stable) throw new Error("Cancelling replace changed the document");
  const bad = path.join(directory, "bad.minicast"); await writeFile(bad, '{"format":"MiniCast","version":999}');
  await open(); await nativeDialog("판서 파일 열기"); await choosePath(bad);
  await waitFor(async () => await status() === "error", 5000, "invalid editable file rejected");
  if (await reason() !== "unsupported-version" || history.getSnapshot(displayId) !== stable) throw new Error("Invalid file damaged the current document");
  await open(); await nativeDialog("판서 파일 열기");
  history.addElement(displayId, { id: "during-open", tool: "pen", color: "#000000", width: 4, opacity: 1, points: [{ x: 260, y: 65 }] }); changed();
  const concurrent = history.getSnapshot(displayId);
  await choosePath(filePath); await waitFor(async () => await status() === "error", 5000, "stale native open rejected");
  if (await reason() !== "stale-document" || history.getSnapshot(displayId) !== concurrent) throw new Error("Open overwrote concurrent editing");
  const rejected = await target.webContents.executeJavaScript(`miniCast.annotationFile({displayId:${displayId},action:'open'})`);
  if (rejected.reason !== "invalid-request") throw new Error("Overlay could open arbitrary native file workflows");
  const loaded = new Promise<void>(resolve => target.webContents.once("did-finish-load", () => resolve()));
  target.webContents.reload(); await loaded; await ready();
  if (elements() !== JSON.stringify(concurrent.elements)) throw new Error("Loaded document lost on renderer reload");
  return { nativeSave: true, nativeOpen: true, pinnedSave: true, undoRedo: true, pixels: true,
    savedState: true, cancel: true, invalidFile: true, staleOpen: true, sharedGate: true, senderRejected: true, reload: true };
}
