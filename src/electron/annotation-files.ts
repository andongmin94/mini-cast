import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import {
  ANNOTATION_FILE_EXTENSION, AnnotationFileError, fitAnnotationFile, readAnnotationFileRequest,
  serializeAnnotationFile, type AnnotationFileResult,
} from "../annotation/document-file.js";
import { AnnotationError } from "../annotation/errors.js";
import type { AnnotationHistory } from "../annotation/history.js";
import { AnnotationIoGate } from "./annotation-io-gate.js";
import { loadAnnotationFile, saveAnnotationFile } from "./annotation-file-store.js";
import { mainWindow, overlayDisplays, overlayWindows } from "./window.js";

interface Options {
  history: AnnotationHistory;
  gate: AnnotationIoGate;
  unavailable(): boolean;
  prepareDialog(): void;
  documentChanged(displayId: number): void;
}

export function registerAnnotationFiles(options: Options) {
  ipcMain.handle("annotation-file", async (event, value: unknown): Promise<AnnotationFileResult> => {
    const controller = mainWindow;
    if (!controller || controller.isDestroyed() || !controller.isVisible() || event.sender.isDestroyed() ||
        event.sender !== controller.webContents || event.senderFrame !== event.sender.mainFrame)
      return { status: "error", reason: "invalid-request" };
    const request = readAnnotationFileRequest(value);
    if (!request) return { status: "error", reason: "invalid-request" };
    if (options.gate.busy) return { status: "error", reason: "busy" };
    if (options.unavailable()) return { status: "error", reason: "unavailable" };
    const index = overlayDisplays.findIndex(display => display.id === request.displayId);
    const target = overlayWindows[index];
    if (!target || target.isDestroyed() || target.webContents.isDestroyed())
      return { status: "error", reason: "unavailable" };
    const release = options.gate.acquire();
    if (!release) return { status: "error", reason: "busy" };
    const owner = controller.webContents;
    const contents = target.webContents;
    let invalidated = false;
    let publication: Promise<void> | null = null;
    let quitRequested = false;
    const invalidate = () => { if (!publication) invalidated = true; };
    const beforeQuit = (event: Electron.Event) => {
      if (!publication) { invalidate(); return; }
      event.preventDefault();
      if (quitRequested) return;
      quitRequested = true;
      void publication.then(() => app.quit(), () => app.quit());
    };
    const valid = () => {
      if (invalidated || options.unavailable() || controller.isDestroyed() || owner.isDestroyed() ||
          !controller.isVisible() || target.isDestroyed() || contents.isDestroyed() || !overlayWindows.includes(target) ||
          !overlayDisplays.some(display => display.id === request.displayId))
        throw new AnnotationFileError("unavailable");
    };
    owner.on("did-start-loading", invalidate);
    owner.once("destroyed", invalidate);
    contents.on("did-start-loading", invalidate);
    contents.once("destroyed", invalidate);
    app.on("before-quit", beforeQuit);
    try {
      options.prepareDialog();
      valid();
      const original = options.history.getSnapshot(request.displayId);
      if (!original.viewport) throw new AnnotationFileError("unavailable");
      const filters = [{ name: "MiniCast 판서 파일", extensions: [ANNOTATION_FILE_EXTENSION] }];
      if (request.action === "save") {
        const serialized = serializeAnnotationFile(original);
        const result = await dialog.showSaveDialog(controller, {
          title: "판서 파일 저장", filters,
          defaultPath: path.join(app.getPath("documents"), `MiniCast-${new Date().toISOString().replace(/[:.]/g, "-")}.${ANNOTATION_FILE_EXTENSION}`),
          properties: ["showOverwriteConfirmation", "dontAddToRecent"],
        });
        if (result.canceled || !result.filePath) return { status: "cancelled" };
        valid();
        publication = saveAnnotationFile(result.filePath, serialized);
        await publication;
        return { status: "saved", fileName: path.basename(result.filePath), elements: original.elements.length,
          revision: original.revision, changed: false };
      }
      const opened = await dialog.showOpenDialog(controller, { title: "판서 파일 열기", filters, properties: ["openFile", "dontAddToRecent"] });
      if (opened.canceled || !opened.filePaths.length) return { status: "cancelled" };
      if (opened.filePaths.length !== 1) throw new AnnotationFileError("invalid-request");
      valid();
      const file = await loadAnnotationFile(opened.filePaths[0], () => invalidated);
      valid();
      const unchanged = () => {
        valid();
        if (options.history.getSnapshot(request.displayId).revision !== original.revision)
          throw new AnnotationFileError("stale-document");
      };
      unchanged();
      const elements = fitAnnotationFile(file, original.viewport);
      if (original.elements.length) {
        const confirmation = await dialog.showMessageBox(controller, {
          type: "question", title: "판서 교체 확인", message: "선택한 화면의 판서를 파일 내용으로 교체할까요?",
          detail: `현재 ${original.elements.length}개 객체를 ${elements.length}개 객체로 교체합니다. 열기는 한 번의 실행취소로 되돌릴 수 있습니다. 다른 화면의 판서는 유지됩니다.`,
          buttons: ["취소", "교체"], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (confirmation.response !== 1) return { status: "cancelled" };
      }
      unchanged();
      const changed = options.history.replaceDocumentElements(request.displayId, elements, original.revision) !== null;
      if (changed) options.documentChanged(request.displayId);
      return { status: "opened", fileName: path.basename(opened.filePaths[0]), elements: elements.length,
        revision: options.history.getSnapshot(request.displayId).revision, changed };
    } catch (error) {
      if (error instanceof AnnotationFileError) return { status: "error", reason: error.reason };
      if (error instanceof AnnotationError)
        return { status: "error", reason: error.reason === "stale-document" ? "stale-document" : "invalid-file" };
      console.error("Annotation file operation failed:", error);
      return { status: "error", reason: request.action === "save" ? "write-failed" : "read-failed" };
    } finally {
      owner.removeListener("did-start-loading", invalidate);
      owner.removeListener("destroyed", invalidate);
      contents.removeListener("did-start-loading", invalidate);
      contents.removeListener("destroyed", invalidate);
      app.removeListener("before-quit", beforeQuit);
      release();
    }
  });
}
