import { app, clipboard, nativeImage, screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AnnotationHistory } from "../../annotation/history.js";
import { injectWindowsShortcut, waitFor } from "./smoke.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { verifyAnnotationExportRendering } from "./export-rendering-smoke.js";

interface Context {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  click(selector: string, description: string): Promise<void>;
}

async function readClipboardImage() {
  const item = (await clipboard.read()).find(candidate => candidate.types.includes("image/png"));
  if (!item) throw new Error("Clipboard has no PNG image");
  const payload = await item.getType("image/png");
  if (!(payload instanceof Blob)) throw new Error("Clipboard PNG is not a Blob");
  return nativeImage.createFromBuffer(Buffer.from(await payload.arrayBuffer()));
}

async function waitForSaveDialog() {
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ExportDialog {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
for ($i=0; $i -lt 100; $i++) {
  $window=[ExportDialog]::FindWindow("#32770", "판서 PNG 저장")
  if ($window -ne [IntPtr]::Zero) { [ExportDialog]::SetForegroundWindow($window) | Out-Null; exit 0 }
  Start-Sleep -Milliseconds 50
}
throw "Native PNG save dialog not found"
`], { windowsHide: true, timeout: 10_000 });
}

export async function verifyAnnotationExports(context: Context, displayId: number) {
  const controller=mainWindow;
  const target=overlayWindows[overlayDisplays.findIndex(display=>display.id===displayId)];
  if(!controller||!target) throw new Error("Missing export test windows");
  const history=context.history;
  const directory=path.join(app.getPath("userData"),"png-export-check");
  await mkdir(directory,{recursive:true});
  history.clearDisplay(displayId);
  history.addElement(displayId,{id:"export-fill",tool:"rectangle",color:"#FF0000",fill:"#12AB34",width:2,opacity:1,
    points:[{x:10,y:10},{x:60,y:10},{x:10,y:50}]});
  history.addElement(displayId,{id:"export-marker",tool:"highlighter",color:"#FFD60A",width:8,opacity:0.35,
    points:[{x:10,y:90},{x:140,y:90}]});
  history.addElement(displayId,{id:"redo-kept",tool:"pen",color:"#000000",width:2,opacity:1,points:[{x:200,y:200}]});
  history.undo();
  context.publishDocument(displayId);
  const snapshot=history.getSnapshot(displayId), before=JSON.stringify(snapshot);
  const rendering=await verifyAnnotationExportRendering(target.webContents);
  const state=()=>controller.webContents.executeJavaScript("document.querySelector('[data-export-status]')?.getAttribute('data-export-status')");
  await context.click('[data-mini-cast-tab="annotation"]',"export annotation tab");
  const selected=await controller.webContents.executeJavaScript("Number(document.querySelector('[data-export-display]')?.value)");
  if(selected!==displayId) throw new Error("Export defaults to the wrong monitor");
  await clipboard.writeText("untouched-export-marker");
  await context.click('[data-export-action="clipboard"]',"actual image-copy button");
  await waitFor(async()=>await state()==="copied",5000,"native clipboard image copied");
  const image=await readClipboardImage(), physical=screen.getAllDisplays().find(display=>display.id===displayId)!;
  const width=Math.round(snapshot.viewport!.width*physical.scaleFactor), height=Math.round(snapshot.viewport!.height*physical.scaleFactor);
  const size=image.getSize();
  if(image.isEmpty()||size.width!==width||size.height!==height) throw new Error("Clipboard image has wrong pixel dimensions");
  const originalBitmap=image.toBitmap();
  const alpha=(x:number,y:number)=>originalBitmap[4*(Math.floor(y*physical.scaleFactor)*width+Math.floor(x*physical.scaleFactor))+3];
  if(alpha(25,25)!==255||alpha(155,110)!==0||alpha(20,90)<80||alpha(20,90)>100)
    throw new Error("Clipboard did not preserve transparent/filled/translucent pixels");
  if(JSON.stringify(history.getSnapshot(displayId))!==before||!history.canRedo) throw new Error("Copy changed history or Redo");

  const senderResult=await target.webContents.executeJavaScript(`miniCast.exportAnnotation({displayId:${displayId},destination:'clipboard'})`);
  if(senderResult.status!=="error"||senderResult.reason!=="invalid-request") throw new Error("Overlay could write directly to the clipboard");
  if(!(await readClipboardImage()).toBitmap().equals(originalBitmap)) throw new Error("Rejected sender changed clipboard");

  await context.click('[data-export-action="file"]',"actual PNG-save button");
  await waitForSaveDialog();
  const overlapping=await controller.webContents.executeJavaScript(`miniCast.exportAnnotation({displayId:${displayId},destination:'clipboard'})`);
  if(overlapping.reason!=="busy") throw new Error("A second export replaced an open native dialog");
  history.addElement(displayId,{id:"after-export-start",tool:"pen",color:"#000000",width:20,opacity:1,points:[{x:155,y:110}]});
  context.publishDocument(displayId);
  const output=path.join(directory,"annotation.png");
  await clipboard.writeText(output);
  await injectWindowsShortcut("Alt+N");
  await injectWindowsShortcut("Control+A");
  await injectWindowsShortcut("Control+V");
  await injectWindowsShortcut("Enter");
  await waitFor(async()=>await state()==="saved",7000,"PNG written after native save confirmation");
  const saved=nativeImage.createFromBuffer(await readFile(output));
  if(!saved.toBitmap().equals(originalBitmap)) throw new Error("Saved PNG changed after a concurrent edit, or differs from copy");
  if(history.getSnapshot(displayId).elements.length!==snapshot.elements.length+1) throw new Error("Export overwrote a newer document");

  await context.click('[data-export-action="file"]',"save-cancel button");
  await waitForSaveDialog(); await injectWindowsShortcut("Escape");
  await waitFor(async()=>await state()==="cancelled",5000,"native Save dialog cancellation");
  if((await readdir(directory)).join(",")!=="annotation.png") throw new Error("Cancelled export wrote a file or left a temporary file");
  history.clearDisplay(displayId); context.publishDocument(displayId);
  await clipboard.writeText("empty-export-must-not-clear-clipboard");
  await context.click('[data-export-action="clipboard"]',"empty-document copy request");
  await waitFor(async()=>await state()==="error",5000,"empty document is reported");
  if(await clipboard.readText()!=="empty-export-must-not-clear-clipboard") throw new Error("Empty export destroyed clipboard contents");
  return {rendering,clipboard:true,transparent:true,pngFile:true,nativeDialog:true,cancel:true,
    pinnedRevision:true,historyIsolated:true,busy:true,senderRejected:true,emptyPreservesClipboard:true};
}
