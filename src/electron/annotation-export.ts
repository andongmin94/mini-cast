import { app, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AnnotationExportError, planAnnotationExport, readAnnotationExportRequest, type AnnotationExportResult } from "../annotation/export.js";
import type { AnnotationHistory } from "../annotation/history.js";
import { ExportRenderSession } from "./export-render-session.js";
import { writePngFile } from "./png-file.js";
import { mainWindow, overlayDisplays, overlayWindows } from "./window.js";

interface Options {
  history: AnnotationHistory;
  unavailable(): boolean;
  prepareFileDialog(): void;
}

/** Native clipboard/filesystem access is not exposed as a general renderer API. */
export function registerAnnotationExports(options: Options) {
  const renders = new ExportRenderSession();
  let busy = false;
  const topLevel = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame;

  ipcMain.on("annotation-export-rendered", (event, id: unknown, bytes: unknown) => {
    if (topLevel(event)) renders.reply(event.sender.id, id, bytes);
  });

  ipcMain.handle("annotation-export", async (event, value: unknown): Promise<AnnotationExportResult> => {
    const controller = mainWindow;
    if (!topLevel(event) || !controller || controller.isDestroyed() ||
        controller.webContents !== event.sender || !controller.isVisible())
      return { status: "error", reason: "invalid-request" };
    const request = readAnnotationExportRequest(value);
    if (!request) return { status: "error", reason: "invalid-request" };
    if (busy) return { status: "error", reason: "busy" };
    if (options.unavailable()) return { status: "error", reason: "unavailable" };
    const index = overlayDisplays.findIndex(display => display.id === request.displayId);
    const target = overlayWindows[index];
    const physical = screen.getAllDisplays().find(display => display.id === request.displayId);
    if (!target || target.isDestroyed() || target.webContents.isDestroyed() || !physical)
      return { status: "error", reason: "unavailable" };

    busy = true;
    let cancelled = false;
    let publishing = false;
    let publication: Promise<void> | null = null;
    let quitRequested = false;
    const beforeQuit = (event: Electron.Event) => {
      if (!publication) { invalidate(); return; }
      event.preventDefault();
      if (quitRequested) return;
      quitRequested = true;
      void publication.then(() => app.quit(), () => app.quit());
    };
    const invalidate = () => {
      // A user-authorized atomic write already in progress is allowed to finish.
      if (publishing) return;
      cancelled = true;
      renders.cancel("unavailable");
    };
    const contents = target.webContents;
    const owner = controller.webContents;
    const valid = () => {
      if (cancelled || options.unavailable() || target.isDestroyed() || contents.isDestroyed() ||
          controller.isDestroyed() || owner.isDestroyed() || !overlayWindows.includes(target) ||
          !screen.getAllDisplays().some(display => display.id === request.displayId))
        throw new AnnotationExportError("unavailable");
    };
    contents.on("did-start-loading", invalidate);
    contents.once("destroyed", invalidate);
    owner.on("did-start-loading", invalidate);
    owner.once("destroyed", invalidate);
    app.on("before-quit", beforeQuit);
    try {
      const snapshot = options.history.getSnapshot(request.displayId);
      const scale = physical.scaleFactor;
      const size = planAnnotationExport(snapshot, scale);
      const id = randomUUID();
      const reply = renders.begin(contents.id, id, size);
      try { contents.send("annotation-export-render", { id, snapshot, scale, ...size }); }
      catch { renders.cancel("unavailable"); }
      const bytes = await reply;
      valid();
      const image = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
      const decoded = image.getSize();
      if (image.isEmpty() || decoded.width !== size.width || decoded.height !== size.height)
        throw new AnnotationExportError("render-failed");
      const png = image.toPNG();
      if (request.destination === "clipboard") {
        valid();
        publishing = true;
        publication = clipboard.write([
          new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) }),
        ]);
        await publication;
        return { status: "copied", revision: snapshot.revision, ...size };
      }
      options.prepareFileDialog();
      valid();
      const result = await dialog.showSaveDialog(controller, {
        title: "판서 PNG 저장",
        defaultPath: path.join(app.getPath("pictures"), `MiniCast-${new Date().toISOString().replace(/[:.]/g, "-")}.png`),
        filters: [{ name: "PNG 이미지", extensions: ["png"] }],
        properties: ["showOverwriteConfirmation", "dontAddToRecent"],
      });
      if (result.canceled || !result.filePath) return { status: "cancelled" };
      valid();
      publishing = true;
      publication = writePngFile(result.filePath, png);
      await publication;
      return { status: "saved", fileName: path.basename(result.filePath), revision: snapshot.revision, ...size };
    } catch (error) {
      if (!(error instanceof AnnotationExportError)) console.error("Annotation export failed:", error);
      const reason = error instanceof AnnotationExportError ? error.reason : "write-failed";
      return reason === "cancelled" ? { status: "cancelled" } : { status: "error", reason };
    } finally {
      renders.cancel();
      busy = false;
      contents.removeListener("did-start-loading", invalidate);
      contents.removeListener("destroyed", invalidate);
      owner.removeListener("did-start-loading", invalidate);
      owner.removeListener("destroyed", invalidate);
      app.removeListener("before-quit", beforeQuit);
    }
  });
}
