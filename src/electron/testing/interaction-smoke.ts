import { framePoint } from "../../annotation/primitive-frame.js";
import { verifyTransientTools } from "./transient-smoke.js";
import { verifyShapeFill } from "./fill-smoke.js";
import { verifySelectionFlip } from "./flip-smoke.js";
import { verifyExistingTextEditing } from "./text-edit-smoke.js";
import { verifySelectionRotation } from "./rotation-smoke.js";
import { verifySelectionResize } from "./resize-smoke.js";
import { verifyDirtyCanvasRendering } from "./rendering-smoke.js";
import { app, BrowserWindow, globalShortcut, screen, type WebContents } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import {
  prepareEraserElement,
  eraserSweepHitsPreparedElement,
} from "../../annotation/eraser-index.js";
import { eraserSweepHitsStroke } from "../../annotation/geometry.js";
import type { AnnotationHistory } from "../../annotation/history.js";
import type {
  AnnotationCommand,
  AnnotationState,
  AnnotationTool,
} from "../../shared/contract.js";
import type { SettingsWriteState } from "../settings-writer.js";
import {
  ACTIVE_COMMAND_SHORTCUTS,
  TOOL_SHORTCUTS,
} from "../annotation-shortcuts.js";
import {
  injectWindowsClick,
  injectWindowsDrag,
  injectWindowsShortcut,
  injectWindowsMouseButton,
  injectWindowsMouseMove,
  waitFor,
} from "./smoke.js";
import {
  hideMainWindow,
  mainWindow,
  overlayDisplays,
  overlayWindows,
  showMainWindow,
} from "../window.js";

export interface SmokeContext {
  history: AnnotationHistory;
  state(): AnnotationState;
  refreshDisplays(): Promise<void>;
  publishDocument(displayId: number): void;
  settingsPath: string;
  settingsState(): SettingsWriteState;
}

/** Test orchestration uses production services only for fixtures and observations. */
export function createSmokeChecks(context: SmokeContext) {
  const annotationHistory = context.history;
  const diagnostics: Record<string, unknown> = {};

  async function selectTool(tool: AnnotationTool) {
    const binding = TOOL_SHORTCUTS.find((item) => item.tool === tool);
    if (!binding) throw new Error(`No accelerator for ${tool}`);
    await injectWindowsShortcut(binding.accelerator);
    await waitFor(
      () => context.state().tool === tool,
      5_000,
      `native tool shortcut ${binding.accelerator}`,
    );
  }

  async function shortcutCommand(command: AnnotationCommand) {
    const binding = ACTIVE_COMMAND_SHORTCUTS.find(
      (item) => item.command === command,
    );
    if (!binding) throw new Error(`No accelerator for ${command}`);
    await injectWindowsShortcut(binding.accelerator);
  }

  async function canvasAlphaAt(displayId: number, x: number, y: number) {
    const target =
      overlayWindows[
      overlayDisplays.findIndex((item) => item.id === displayId)
      ];
    if (!target) throw new Error("Missing annotation surface");
    return (await target.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('canvas');
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) return -1;
      const x = Math.round(${x} * canvas.width / canvas.clientWidth);
      const y = Math.round(${y} * canvas.height / canvas.clientHeight);
      return context.getImageData(x, y, 1, 1).data[3];
    })()`)) as number;
  }

  async function verifySettingsFailureAndRetry() {
    const controller = mainWindow;
    if (!controller) throw new Error("Missing controller");
    const file = context.settingsPath;
    const backup = file + ".smoke-backup";
    await waitFor(
      () => context.settingsState() !== "pending",
      5_000,
      "initial preference write",
    );
    if (!existsSync(file))
      throw new Error("The isolated settings file was not created");
    renameSync(file, backup);
    mkdirSync(file);
    try {
      await controller.webContents.executeJavaScript(`(async () => {
        const settings = await miniCast.getSettings();
        miniCast.saveSettings({ ...settings, cursorSize: 36 });
      })()`);
      await waitFor(
        () => context.settingsState() === "failed",
        5_000,
        "actual filesystem write failure is contained",
      );
      await waitFor(
        async () =>
          Boolean(
            await controller.webContents.executeJavaScript(
              "Boolean(document.querySelector('[data-settings-status=failed]'))",
            ),
          ),
        5_000,
        "settings failure notice reaches the controller",
      );
    } finally {
      rmdirSync(file);
      renameSync(backup, file);
    }
    await clickControllerElement(
      controller,
      "[data-settings-retry]",
      "explicit settings Retry button",
    );
    await waitFor(
      () => context.settingsState() === "saved",
      5_000,
      "settings Retry writes the retained value",
    );
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    if (persisted.settings.cursorSize !== 36)
      throw new Error("Retry did not persist the latest preferences");
    diagnostics.settingsFailureAndRetry = true;
  }

  async function measureAnnotationPipeline(
    displayId: number,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const viewport = annotationHistory.getSnapshot(displayId).viewport;
    if (!viewport) throw new Error("Missing benchmark viewport");
    const beforePixels = await committedCanvasInkPixels(displayId);
    const begin = performance.now();
    for (let index = 0;index < 1000;index += 1) {
      annotationHistory.addElement(displayId, {
        id: `stress-${index}`,
        tool: "pen",
        color: "#007AFF",
        width: 1,
        opacity: 1,
        points: Array.from({ length: 128 }, (_, point) => ({
          x:
            (((index % 40) + 0.1 + (point / 127) * 0.8) / 40) *
            Math.min(viewport.width, 800),
          y:
            ((Math.floor(index / 40) + 0.5) / 25) *
            Math.min(viewport.height, 500),
        })),
      });
    }
    const fixtureMs = performance.now() - begin;
    const snapshotStart = performance.now();
    const snapshot = annotationHistory.getSnapshot(displayId);
    const snapshotMs = performance.now() - snapshotStart;
    const cacheStart = performance.now();
    for (let iteration = 0;iteration < 1000;iteration += 1) {
      if (annotationHistory.getSnapshot(displayId) !== snapshot)
        throw new Error("Stable revision was unnecessarily cloned");
    }
    const cachedSnapshotReads1000Ms = performance.now() - cacheStart;
    const prepareStart = performance.now();
    const prepared = snapshot.elements.map(prepareEraserElement);
    const eraserPrepareMs = performance.now() - prepareStart;
    const sweepStart = { x: 350, y: 10 };
    const sweepEnd = { x: 450, y: 10 };
    const eraserQueryStats = {
      strokeBoundsTests: 0,
      blockBoundsTests: 0,
      segmentTests: 0,
    };
    const indexedStart = performance.now();
    const indexedIds = prepared
      .filter((item) =>
        eraserSweepHitsPreparedElement(
          sweepStart,
          sweepEnd,
          item,
          4,
          eraserQueryStats,
        ),
      )
      .map((item) => item.stroke.id);
    const indexedEraserMs = performance.now() - indexedStart;
    const referenceStart = performance.now();
    const referenceIds = snapshot.elements
      .filter((item) => eraserSweepHitsStroke(sweepStart, sweepEnd, item, 4))
      .map((item) => item.id);
    const exhaustiveEraserMs = performance.now() - referenceStart;
    if (JSON.stringify(indexedIds) !== JSON.stringify(referenceIds))
      throw new Error("Indexed eraser differs from exhaustive reference");
    if (eraserQueryStats.segmentTests >= 12800)
      throw new Error(
        "Local eraser query traversed too much unrelated geometry",
      );
    const serializeStart = performance.now();
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    const serializeMs = performance.now() - serializeStart;
    const publishStart = performance.now();
    context.publishDocument(displayId);
    const target =
      overlayWindows[
      overlayDisplays.findIndex((item) => item.id === displayId)
      ];
    if (!target) throw new Error("Missing benchmark renderer");
    diagnostics.dirtyCanvasReference = await verifyDirtyCanvasRendering(
      target.webContents,
    );
    await waitFor(
      async () =>
        Number(
          await target.webContents.executeJavaScript(
            "document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationElements",
          ),
        ) === snapshot.elements.length,
      10_000,
      "128k-point snapshot reaches the renderer",
    );
    await waitFor(
      async () =>
        (await committedCanvasInkPixels(displayId)) > beforePixels + 500,
      10_000,
      "large fixture actually paints additional Canvas pixels",
    );
    const publishAndPaintMs = performance.now() - publishStart;
    await selectTool("pen");
    await waitForOverlayInput(displayId, true);
    // Probe the actual preload/invoke return. Deliberately do not feed this reply
    // to the UI replica, simulating a lost commit acknowledgement. Native Undo
    // must then recover the resulting revision gap from the authoritative source.
    const deltaProbe = await target.webContents
      .executeJavaScript(`(async () => {
      const entries = [];
      window.__miniCastWireAudit = { entries, stop: miniCast.onAnnotationDocumentUpdated(update => {
        entries.push({ kind: update.kind, bytes: JSON.stringify(update).length,
          inserted: update.kind === 'delta' ? update.inserted.length : null });
      }) };
      const gestureId = crypto.randomUUID();
      miniCast.beginAnnotationGesture(gestureId);
      try {
        const result = await miniCast.commitAnnotationElement(gestureId, {
          id: crypto.randomUUID(), tool: 'pen', color: '#123456', width: 4, opacity: 1,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        });
        if (!result.accepted || result.update.kind !== 'delta') throw new Error('Expected an accepted small delta reply');
        return { kind: result.update.kind, replyBytes: JSON.stringify(result).length,
          inserted: result.update.inserted.length, removed: result.update.removedIds.length };
      } finally { miniCast.endAnnotationGesture(gestureId); }
    })()`);
    if (
      deltaProbe.replyBytes >= 2048 ||
      deltaProbe.inserted !== 1 ||
      deltaProbe.removed !== 0
    )
      throw new Error("Small edit reply transferred unrelated geometry");
    await shortcutCommand("undo");
    await waitFor(
      async () => {
        const expected = annotationHistory.getSnapshot(displayId);
        return (
          expected.elements.length === snapshot.elements.length &&
          Number(
            await target.webContents.executeJavaScript(
              "document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision",
            ),
          ) === expected.revision
        );
      },
      10_000,
      "revision-gap recovery after a lost commit reply",
    );
    diagnostics.deltaTransport = {
      ...deltaProbe,
      baselineSnapshotBytes: bytes,
      gapRecovered: true,
    };
    const dragStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).elements.length ===
        snapshot.elements.length + 1,
      10_000,
      "native drawing still commits over a 128k-point document",
    );
    const nativeDragIncludingInjectionMs = performance.now() - dragStart;
    await shortcutCommand("undo");
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).elements.length ===
        snapshot.elements.length,
      10_000,
      "native Undo on the large document",
    );
    await selectTool("eraser");
    await waitForOverlayInput(displayId, true);
    const eraseStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).elements.length <
        snapshot.elements.length,
      10_000,
      "native indexed erasing on the 128k-point document",
    );
    const nativeEraseIncludingInjectionMs = performance.now() - eraseStart;
    await shortcutCommand("undo");
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).elements.length ===
        snapshot.elements.length,
      10_000,
      "Undo restores every stroke removed by the indexed eraser",
    );
    if (
      JSON.stringify(annotationHistory.getSnapshot(displayId).elements) !==
      JSON.stringify(snapshot.elements)
    )
      throw new Error("Large eraser Undo changed the document geometry");
    const wireUpdates = await target.webContents.executeJavaScript(`(() => {
      const audit = window.__miniCastWireAudit;
      audit.stop(); delete window.__miniCastWireAudit; return audit.entries;
    })()`);
    if (
      wireUpdates.length < 3 ||
      wireUpdates.some((entry: { kind: string }) => entry.kind !== "delta")
    )
      throw new Error("Normal Undo/Redo edits did not use delta IPC");
    diagnostics.deltaWireUpdates = wireUpdates;
    const metrics = {
      fixtureStrokes: 1000,
      fixturePoints: 128000,
      snapshotBytes: bytes,
      fixtureMs,
      snapshotMs,
      cachedSnapshotReads1000Ms,
      eraserPrepareMs,
      indexedEraserMs,
      exhaustiveEraserMs,
      eraserQueryStats,
      serializeMs,
      publishAndPaintMs,
      nativeDragIncludingInjectionMs,
      nativeEraseIncludingInjectionMs,
      mainMemory: process.memoryUsage(),
      processes: app
        .getAppMetrics()
        .map(({ type, memory }) => ({ type, memory })),
    };
    console.log(
      "MiniCast bounded stress diagnostics:",
      JSON.stringify(metrics),
    );
    return metrics;
  }

  async function verifyShapeAndTextTools(
    displayId: number,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const controller = mainWindow;
    const display = screen.getAllDisplays().find(item => item.id === displayId);
    if (!controller || !display) throw new Error("Missing shape test windows");
    const area = display.workArea;
    const controllerBounds = controller.getBounds();
    controller.setPosition(area.x + area.width - controllerBounds.width - 8, area.y + 8);
    const localStart = { x: start.x - display.bounds.x, y: start.y - display.bounds.y };
    const localEnd = { x: end.x - display.bounds.x, y: end.y - display.bounds.y };
    async function clearDocument() {
      await injectWindowsMouseMove(start.x, start.y);
      await shortcutCommand("clear");
      await waitFor(() => annotationHistory.getSnapshot(displayId).elements.length === 0, 5000, "clear shape fixture");
      await waitForCommittedCanvasInk(displayId, false, "empty shape fixture pixels");
    }
    const inputWindow = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
    await inputWindow.webContents.executeJavaScript(`(() => {
      window.__miniCastToolTrace = [];
      const trace = item => {
        window.__miniCastToolTrace.push(item);
        if (window.__miniCastToolTrace.length > 30) window.__miniCastToolTrace.shift();
      };
      for (const name of ['pointerdown','pointerup','pointercancel','lostpointercapture']) {
        document.addEventListener(name, event => trace({ name, x:event.clientX, y:event.clientY,
          pointerId:event.pointerId, target:event.target.tagName, buttons:event.buttons }), true);
      }
      window.addEventListener('error', event => trace({ error: event.message, stack: event.error?.stack }));
    })()`);
    for (const tool of ["line", "arrow", "rectangle", "ellipse"] as const) {
      await clickControllerElement(controller, `[data-annotation-tool="${tool}"]`, tool + " button");
      await waitFor(() => context.state().tool === tool, 5000, tool + " selected");
      await clearDocument();
      await waitForOverlayInput(displayId, true);
      await injectWindowsDrag(start.x, start.y, end.x, end.y);
      try {
        await waitFor(() => annotationHistory.getSnapshot(displayId).elements.length === 1, 5000, tool + " commit");
      } catch (error) {
        const renderer = await inputWindow.webContents.executeJavaScript(`(() => {
          const canvas = document.querySelectorAll('canvas')[1];
          return { trace:window.__miniCastToolTrace, notice:document.querySelector('[data-annotation-notice]')?.textContent,
            canvas:{ width:canvas?.clientWidth, height:canvas?.clientHeight, active:canvas?.dataset.activeGesture,
              cursor:canvas?.style.cursor, pointerEvents:canvas?.style.pointerEvents },
            root:document.querySelector('[data-mini-cast-overlay]')?.dataset };
        })()`);
        console.error('SHAPE_INPUT_DIAGNOSTIC', JSON.stringify({ tool, start, end,
          controller:controller.getBounds(), overlay:inputWindow.getBounds(), state:context.state(),
          document:annotationHistory.getSnapshot(displayId), renderer }));
        throw error;
      }
      const element = annotationHistory.getSnapshot(displayId).elements[0];
      if (element.tool !== tool || element.points.length !== (tool === "rectangle" || tool === "ellipse" ? 3 : 2)) throw new Error(tool + " anchors were not stored");
      await waitForCommittedCanvasInk(displayId, true, tool + " pixels");
      const testPoint = tool === "ellipse" ? { x: localEnd.x, y: (localStart.y + localEnd.y) / 2 }
        : tool === "rectangle" ? { x: (localStart.x + localEnd.x) / 2, y: localStart.y }
          : { x: (localStart.x + localEnd.x) / 2, y: (localStart.y + localEnd.y) / 2 };
      await waitFor(async () => await canvasAlphaAt(displayId, testPoint.x, testPoint.y) > 0, 5000, tool + " outline pixels");
      await shortcutCommand("undo");
      await waitForCommittedCanvasInk(displayId, false, tool + " Undo pixels");
      await shortcutCommand("redo");
      await waitForCommittedCanvasInk(displayId, true, tool + " Redo pixels");
      await selectTool("eraser");
      await injectWindowsDrag(start.x, start.y, end.x, end.y);
      await waitFor(() => annotationHistory.getSnapshot(displayId).elements.length === 0, 5000, tool + " object erase");
      await waitForCommittedCanvasInk(displayId, false, tool + " erased pixels");
    }
    await clickControllerElement(controller, '[data-annotation-tool="text"]', "text tool");
    await waitFor(() => context.state().tool === "text", 5000, "text tool state");
    // An existing element makes a mistakenly captured text-editor Undo observable.
    annotationHistory.addElement(displayId, { id: "text-undo-probe", tool: "pen", points: [localStart], color: "#007AFF", width: 4, opacity: 1 });
    context.publishDocument(displayId);
    const beforeEditing = annotationHistory.getSnapshot(displayId).revision;
    await clickControllerElement(controller, "#annotation-text-content", "text editor focus");
    await waitFor(
      () => !globalShortcut.isRegistered("CommandOrControl+Z"),
      5000,
      "drawing Undo released while editing text",
    );
    // Chromium text insertion supplies the fixture; this is not a physical IME test.
    await controller.webContents.insertText("한글 제목\nPlain <b>text</b>");
    await injectWindowsShortcut("CommandOrControl+Z");
    await waitFor(async () => await controller.webContents.executeJavaScript(`document.querySelector('#annotation-text-content').value === ''`), 5000, "native Undo edits the textarea");
    if (annotationHistory.getSnapshot(displayId).revision !== beforeEditing) throw new Error("Text-editor Undo modified the drawing history");
    await controller.webContents.insertText("한글 제목\nPlain <b>text</b>");
    await clickControllerElement(controller, "[data-annotation-text-prepare]", "text placement button");
    await waitFor(() => context.state().textDraft?.text === "한글 제목\nPlain <b>text</b>", 5000, "text draft IPC");
    await clearDocument();
    await injectWindowsClick(start.x, start.y);
    await waitFor(() => annotationHistory.getSnapshot(displayId).elements[0]?.tool === "text", 5000, "native text placement");
    await waitForCommittedCanvasInk(displayId, true, "isolated text pixels");
    const element = annotationHistory.getSnapshot(displayId).elements[0];
    if (element.tool !== "text") throw new Error("Text element missing");
    const target = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
    const loaded = new Promise<void>(resolve => target.webContents.once("did-finish-load", () => resolve()));
    target.webContents.reload(); await loaded;
    await waitForCommittedCanvasInk(displayId, true, "text pixels restored after renderer reload");
    await shortcutCommand("undo"); await waitForCommittedCanvasInk(displayId, false, "text Undo pixels");
    await shortcutCommand("redo"); await waitForCommittedCanvasInk(displayId, true, "text Redo pixels");
    await selectTool("eraser");
    const center = {
      x: display.bounds.x + framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2).x,
      y: display.bounds.y + framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2).y
    };
    await injectWindowsClick(Math.round(center.x), Math.round(center.y));
    await waitForCommittedCanvasInk(displayId, false, "text object erase");
    diagnostics.shapeAndTextTools = { line: true, arrow: true, rectangle: true, ellipse: true, text: true, textEditorUndo: true, textReload: true };
  }

  async function verifySelectionTools(
    displayId: number,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const controller = mainWindow;
    const display = screen.getAllDisplays().find(item => item.id === displayId);
    const target = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
    if (!controller || !display || !target) throw new Error("Missing selection test windows");
    await clickControllerElement(controller, '[data-annotation-tool="select"]', "selection tool button");
    await waitFor(() => context.state().tool === "select", 5000, "selection tool IPC");
    await waitForOverlayInput(displayId, true);
    annotationHistory.clearDisplay(displayId);
    const points = [start, end].map(point => ({ x: point.x - display.bounds.x, y: point.y - display.bounds.y }));
    for (const id of ["selection-bottom", "selection-top"]) annotationHistory.addElement(displayId,
      { id, tool: "line", color: "#007AFF", opacity: 1, width: 4, points });
    context.publishDocument(displayId);
    const original = annotationHistory.getSnapshot(displayId);
    const center = { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) };
    const delta = { x: 32, y: 40 };
    const movedCenter = { x: center.x + delta.x, y: center.y + delta.y };
    const query = (expression: string) => target.webContents.executeJavaScript(expression);
    const ready = async () => {
      await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-selection-busy="false"]')`)),
        5000, "selection transaction settled");
      await waitFor(async () => Number(await query(`document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision`)) ===
        annotationHistory.getSnapshot(displayId).revision, 5000, "selection document reaches renderer");
    };
    await ready();
    await injectWindowsClick(center.x, center.y);
    await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-selection-count="1"]')`)),
      5000, "object selected by native click");
    if (annotationHistory.getSnapshot(displayId).revision !== original.revision) throw new Error("Selection click changed history");
    await injectWindowsDrag(center.x, center.y, movedCenter.x, movedCenter.y);
    const moved = original.elements.map((element, index) => index === 1 ? {
      ...element, points: element.points.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })),
    } : element);
    await waitFor(() => JSON.stringify(annotationHistory.getSnapshot(displayId).elements) === JSON.stringify(moved),
      5000, "topmost object moves without changing stacking order");
    await ready();
    await waitFor(async () => await canvasAlphaAt(displayId,
      movedCenter.x - display.bounds.x, movedCenter.y - display.bounds.y) > 0, 5000, "translated object pixels");
    await shortcutCommand("undo");
    await waitFor(() => JSON.stringify(annotationHistory.getSnapshot(displayId).elements) === JSON.stringify(original.elements),
      5000, "one Undo restores the whole move");
    await ready();
    await shortcutCommand("redo");
    await waitFor(() => JSON.stringify(annotationHistory.getSnapshot(displayId).elements) === JSON.stringify(moved),
      5000, "move Redo preserves exact coordinates");
    await ready();

    const revisionBeforeCancel = annotationHistory.getSnapshot(displayId).revision;
    try {
      await injectWindowsMouseButton(movedCenter.x, movedCenter.y, true);
      await injectWindowsMouseMove(movedCenter.x + 25, movedCenter.y + 15);
      await waitFor(async () => Boolean(await query("document.querySelector('[data-active-gesture]')")), 5000, "held selection drag");
      await shortcutCommand("undo");
      await waitFor(async () => !(await query("document.querySelector('[data-active-gesture]')")), 5000, "Undo cancels selection preview");
      if (annotationHistory.getSnapshot(displayId).revision !== revisionBeforeCancel) throw new Error("Held selection Undo changed committed history");
    } finally {
      await injectWindowsMouseButton(movedCenter.x + 25, movedCenter.y + 15, false);
    }
    const button = await query(`(() => { const node = document.querySelector('[data-selection-delete]');
      if (!node || node.disabled) return null; const r = node.getBoundingClientRect();
      return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    if (!button) throw new Error("Selection delete action was not enabled");
    const targetBounds = target.getContentBounds();
    await injectWindowsClick(Math.round(targetBounds.x + button.x), Math.round(targetBounds.y + button.y));
    await waitFor(() => annotationHistory.getSnapshot(displayId).elements.length === 1, 5000, "native selected-object delete");
    if (annotationHistory.getSnapshot(displayId).elements[0].id !== "selection-bottom") throw new Error("Selection deleted the wrong layer");
    await ready();
    await shortcutCommand("undo");
    await waitFor(() => JSON.stringify(annotationHistory.getSnapshot(displayId).elements) === JSON.stringify(moved),
      5000, "selection deletion Undo restores IDs and order");
    await ready();
    const stale = await query(`(async () => {
      const snapshot = await miniCast.getAnnotationDocument();
      const id = crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
      try { return await miniCast.editAnnotationSelection(id, {
        kind:'delete', ids:['selection-top'], revision:snapshot.revision - 1,
      }); } finally { miniCast.endAnnotationGesture(id); }
    })()`);
    if (stale.accepted || stale.reason !== "stale-document" ||
      JSON.stringify(annotationHistory.getSnapshot(displayId).elements) !== JSON.stringify(moved))
      throw new Error("Stale selection was not rejected atomically");
    const loaded = new Promise<void>(resolve => target.webContents.once("did-finish-load", () => resolve()));
    target.webContents.reload(); await loaded;
    await ready();
    await waitForCommittedCanvasInk(displayId, true, "selection renderer reload restores committed ink");
    if (!await query(`Boolean(document.querySelector('[data-annotation-selection-count="0"]'))`))
      throw new Error("Transient selection survived renderer reload");
    diagnostics.selectionTools = { topmost: true, move: true, undoRedo: true, delete: true,
      heldUndo: true, staleRevision: true, reload: true };
  }

  interface SmokeState {
    bridge: boolean;
    hash: string;
    rootChildren: number;
  }

  async function inspectRenderer(
    contents: WebContents,
    expectedHash: "#/" | "#/overlay",
  ) {
    const state = (await contents.executeJavaScript(
      `(() => ({
        bridge: typeof window.miniCast === "object",
        hash: window.location.hash,
        rootChildren: document.getElementById("root")?.childElementCount ?? 0
      }))()`,
      true,
    )) as SmokeState;

    if (!state.bridge) throw new Error("preload bridge was not exposed");
    if (state.hash !== expectedHash) {
      throw new Error(`unexpected renderer route: ${state.hash}`);
    }
    if (state.rootChildren < 1) throw new Error("renderer root is empty");
  }

  async function inspectAllRenderers() {
    await waitFor(
      () =>
        Boolean(mainWindow && overlayWindows.length === overlayDisplays.length),
      10_000,
      "application windows",
    );
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("controller window was not created");
    }
    if (!overlayWindows.length)
      throw new Error("no overlay window was created");

    await inspectRenderer(mainWindow.webContents, "#/");
    await Promise.all(
      overlayWindows.map((window) =>
        inspectRenderer(window.webContents, "#/overlay"),
      ),
    );
  }

  async function controllerElementScreenPoint(
    controller: BrowserWindow,
    selector: string,
  ) {
    const encodedSelector = JSON.stringify(selector);
    const center = (await controller.webContents.executeJavaScript(
      `(() => {
        const target = document.querySelector(${encodedSelector});
        if (!(target instanceof HTMLElement)) return null;
        target.scrollIntoView({block: "center", inline: "nearest"});
        const bounds = target.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        };
      })()`,
      true,
    )) as { x: number; y: number } | null;
    if (!center) return null;

    const contentBounds = controller.getContentBounds();
    return {
      x: Math.round(contentBounds.x + center.x),
      y: Math.round(contentBounds.y + center.y),
    };
  }

  async function clickControllerElement(
    controller: BrowserWindow,
    selector: string,
    description: string,
  ) {
    showMainWindow();
    await waitFor(
      async () =>
        Boolean(await controllerElementScreenPoint(controller, selector)),
      5_000,
      description,
    );
    const point = await controllerElementScreenPoint(controller, selector);
    if (!point) throw new Error(`${description} was not visible`);
    await injectWindowsClick(point.x, point.y);
  }

  async function verifyControllerAnnotationToolWiring() {
    const controller = mainWindow;
    if (!controller || controller.isDestroyed()) {
      throw new Error("controller window was not created");
    }

    await clickControllerElement(
      controller,
      '[data-mini-cast-tab="annotation"]',
      "controller annotation tab",
    );
    await waitFor(
      async () =>
        (await controller.webContents.executeJavaScript(
          `document.querySelector('[data-mini-cast-tab="annotation"]')?.getAttribute("data-state") === "active"`,
          true,
        )) as boolean,
      5_000,
      "controller annotation tab active state",
    );
    await clickControllerElement(
      controller,
      '[data-annotation-tool="pen"]',
      "controller pen tool button",
    );
    await waitFor(
      () => context.state().tool === "pen",
      5_000,
      "controller pen tool IPC",
    );
    await clickControllerElement(
      controller,
      '[data-annotation-tool="pass-through"]',
      "controller pass-through tool button",
    );
    await waitFor(
      () => context.state().tool === "pass-through",
      5_000,
      "controller pass-through IPC",
    );
  }

  async function waitForOverlayInput(displayId: number, interactive: boolean) {
    const index = overlayDisplays.findIndex(
      (display) => display.id === displayId,
    );
    const target = overlayWindows[index];
    if (!target) throw new Error("interaction smoke overlay was not found");

    await waitFor(
      async () => {
        const pointerEvents = (await target.webContents.executeJavaScript(
          `(() => {
            const canvases = document.querySelectorAll("canvas");
            return canvases.length > 1
              ? getComputedStyle(canvases[1]).pointerEvents
              : "missing";
          })()`,
          true,
        )) as string;
        return interactive
          ? pointerEvents === "auto"
          : pointerEvents === "none";
      },
      5_000,
      interactive ? "interactive overlay" : "click-through overlay",
    );
  }

  async function committedCanvasInkPixels(displayId: number) {
    const index = overlayDisplays.findIndex(
      (display) => display.id === displayId,
    );
    const target = overlayWindows[index];
    if (!target) throw new Error("annotation canvas overlay was not found");

    return (await target.webContents.executeJavaScript(
      `(() => {
        const canvas = document.querySelector("canvas");
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context) return -1;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) count += 1;
        }
        return count;
      })()`,
      true,
    )) as number;
  }

  async function waitForCommittedCanvasInk(
    displayId: number,
    expected: boolean,
    description: string,
  ) {
    await waitFor(
      async () => {
        const pixels = await committedCanvasInkPixels(displayId);
        return expected ? pixels > 0 : pixels === 0;
      },
      5_000,
      description,
    );
  }

  async function performInteractionSmoke() {
    if (process.platform !== "win32") {
      throw new Error("interaction smoke test requires Windows");
    }
    await inspectAllRenderers();
    await verifySettingsFailureAndRetry();
    await verifyControllerAnnotationToolWiring();

    await selectTool("pen");
    hideMainWindow();
    if (context.state().tool !== "pass-through") {
      throw new Error("hiding the controller did not restore click-through");
    }
    showMainWindow();
    await selectTool("pen");
    mainWindow?.minimize();
    await waitFor(
      () => context.state().tool === "pass-through",
      2_000,
      "click-through after controller minimization",
    );
    showMainWindow();

    const primary = screen.getPrimaryDisplay();
    const area = primary.workArea;
    const width = Math.max(120, Math.min(360, area.width - 40));
    const height = Math.max(100, Math.min(240, area.height - 40));
    const bounds = {
      x: area.x + 20,
      y: area.y + 20,
      width,
      height,
    };
    let clickCount = 0;
    const underlay = new BrowserWindow({
      show: false,
      ...bounds,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: "#ffffff",
    });
    underlay.webContents.on("page-title-updated", (event, title) => {
      const match = /^click-(\d+)$/.exec(title);
      if (!match) return;
      event.preventDefault();
      clickCount = Number(match[1]);
    });
    await underlay.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><title>underlay</title></head><body style="margin:0;width:100vw;height:100vh;background:#fff"><script>let count=0;document.addEventListener('pointerdown',()=>{count+=1;document.title='click-'+count})</script></body></html>`)}`,
    );
    underlay.setAlwaysOnTop(true, "floating");
    underlay.show();
    mainWindow?.hide();

    const start = {
      x: Math.round(bounds.x + width * 0.25),
      y: Math.round(bounds.y + height * 0.35),
    };
    const end = {
      x: Math.round(bounds.x + width * 0.75),
      y: Math.round(bounds.y + height * 0.55),
    };
    const highlighterStart = {
      x: Math.round(bounds.x + width * 0.25),
      y: Math.round(bounds.y + height * 0.8),
    };
    const highlighterEnd = {
      x: Math.round(bounds.x + width * 0.75),
      y: highlighterStart.y,
    };

    try {
      await selectTool("pass-through");
      await waitForOverlayInput(primary.id, false);
      await injectWindowsClick(start.x, start.y);
      await waitFor(() => clickCount === 1, 5_000, "underlay click-through");

      const primaryOverlayIndex = overlayDisplays.findIndex(
        (display) => display.id === primary.id,
      );
      const primaryOverlayBounds = overlayDisplays[primaryOverlayIndex]?.bounds;
      if (
        !primaryOverlayBounds ||
        primaryOverlayBounds.x !== primary.bounds.x ||
        primaryOverlayBounds.y !== primary.bounds.y ||
        primaryOverlayBounds.width !== primary.bounds.width ||
        primaryOverlayBounds.height !== primary.bounds.height
      ) {
        throw new Error("overlay does not cover the full primary display");
      }

      const beforeStrokes = annotationHistory.getSnapshot(primary.id).elements
        .length;
      await waitForCommittedCanvasInk(
        primary.id,
        false,
        "an initially empty annotation canvas",
      );

      await selectTool("pen");
      await waitForOverlayInput(primary.id, true);
      await injectWindowsDrag(start.x, start.y, end.x, end.y);
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length >
          beforeStrokes,
        5_000,
        "OS-injected annotation stroke",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        true,
        "visible committed pen pixels",
      );
      if (clickCount !== 1) {
        throw new Error(
          "interactive overlay leaked the pointer to the underlay",
        );
      }

      await shortcutCommand("undo");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length ===
          beforeStrokes,
        5_000,
        "annotation undo",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        false,
        "visual annotation undo",
      );

      await shortcutCommand("redo");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length >
          beforeStrokes,
        5_000,
        "annotation redo",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        true,
        "visual annotation redo",
      );

      await selectTool("eraser");
      await waitForOverlayInput(primary.id, true);
      await injectWindowsDrag(start.x, start.y, end.x, end.y);
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length ===
          beforeStrokes,
        5_000,
        "OS-injected eraser gesture",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        false,
        "visual eraser result",
      );

      await shortcutCommand("undo");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length >
          beforeStrokes,
        5_000,
        "eraser undo",
      );
      await waitForCommittedCanvasInk(primary.id, true, "visual eraser undo");

      const penStrokeCount = annotationHistory.getSnapshot(primary.id).elements
        .length;
      await selectTool("highlighter");
      await waitForOverlayInput(primary.id, true);
      await injectWindowsDrag(
        highlighterStart.x,
        highlighterStart.y,
        highlighterEnd.x,
        highlighterEnd.y,
      );
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length >
          penStrokeCount,
        5_000,
        "OS-injected highlighter stroke",
      );
      const highlighterStrokes = annotationHistory.getSnapshot(
        primary.id,
      ).elements;
      const highlighter = highlighterStrokes[highlighterStrokes.length - 1];
      if (highlighter?.tool !== "highlighter" || highlighter.opacity !== 0.35) {
        throw new Error("highlighter stroke style was not committed correctly");
      }
      const highlightPoint = {
        x: (highlighterStart.x + highlighterEnd.x) / 2 - primary.bounds.x,
        y: highlighterStart.y - primary.bounds.y,
      };
      await waitFor(
        async () => {
          const alpha = await canvasAlphaAt(
            primary.id,
            highlightPoint.x,
            highlightPoint.y,
          );
          return alpha >= 80 && alpha <= 100;
        },
        5_000,
        "independent highlighter alpha (approximately 0.35)",
      );

      await shortcutCommand("undo");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length ===
          penStrokeCount,
        5_000,
        "highlighter undo",
      );

      await waitFor(
        async () =>
          (await canvasAlphaAt(
            primary.id,
            highlightPoint.x,
            highlightPoint.y,
          )) === 0,
        5_000,
        "highlighter-only region cleared by Undo",
      );
      await shortcutCommand("redo");
      await waitFor(
        async () =>
          (await canvasAlphaAt(
            primary.id,
            highlightPoint.x,
            highlightPoint.y,
          )) >= 80,
        5_000,
        "highlighter-only region restored by Redo",
      );
      await shortcutCommand("undo");
      await waitFor(
        async () =>
          (await canvasAlphaAt(
            primary.id,
            highlightPoint.x,
            highlightPoint.y,
          )) === 0,
        5_000,
        "highlighter-only region cleared again",
      );

      const persisted = annotationHistory.getSnapshot(primary.id);
      await Promise.all([context.refreshDisplays(), context.refreshDisplays()]);
      await inspectAllRenderers();
      await waitForOverlayInput(primary.id, true);

      const rebuiltIndex = overlayDisplays.findIndex(
        (display) => display.id === primary.id,
      );
      const rebuiltOverlay = overlayWindows[rebuiltIndex];
      if (!rebuiltOverlay)
        throw new Error("rebuilt primary overlay was not found");
      await waitFor(
        async () => {
          const state = (await rebuiltOverlay.webContents.executeJavaScript(
            `(() => {
              const root = document.querySelector("[data-mini-cast-overlay]");
              return root
                ? {
                    revision: Number(root.getAttribute("data-annotation-revision")),
                    elements: Number(root.getAttribute("data-annotation-elements"))
                  }
                : null;
            })()`,
            true,
          )) as { revision: number; elements: number } | null;
          return (
            state?.revision === persisted.revision &&
            state.elements === persisted.elements.length
          );
        },
        5_000,
        "annotation restoration after overlay rebuild",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        true,
        "visual annotation restoration after overlay rebuild",
      );

      const loaded = new Promise<void>((resolve) =>
        rebuiltOverlay.webContents.once("did-finish-load", () => resolve()),
      );
      rebuiltOverlay.webContents.reload();
      await loaded;
      await waitFor(
        async () => {
          const restored = await rebuiltOverlay.webContents
            .executeJavaScript(`(() => {
          const root = document.querySelector('[data-mini-cast-overlay]');
          return root && Number(root.dataset.annotationRevision) === ${persisted.revision}
            && Number(root.dataset.annotationElements) === ${persisted.elements.length};
        })()`);
          return Boolean(restored);
        },
        5_000,
        "real renderer reload restores the document revision and elements",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        true,
        "real renderer reload restores Canvas pixels",
      );

      const beforeCancellation = annotationHistory.getSnapshot(primary.id);
      await selectTool("eraser");
      await waitForOverlayInput(primary.id, true);
      try {
        await injectWindowsMouseButton(start.x, start.y, true);
        await injectWindowsMouseMove(end.x, end.y);
        await waitForCommittedCanvasInk(
          primary.id,
          false,
          "held eraser preview removes the pen pixels",
        );
        await shortcutCommand("undo");
        await waitFor(
          async () =>
            !(await rebuiltOverlay.webContents.executeJavaScript(
              "Boolean(document.querySelector('[data-active-gesture]'))",
            )),
          5_000,
          "Ctrl+Z cancels the held eraser gesture",
        );
        await waitForCommittedCanvasInk(
          primary.id,
          true,
          "cancelled eraser preview restores the pen pixels",
        );
        if (
          annotationHistory.getSnapshot(primary.id).revision !==
          beforeCancellation.revision
        ) {
          throw new Error("Cancelling the eraser changed committed history");
        }
      } finally {
        await injectWindowsMouseButton(end.x, end.y, false);
      }
      diagnostics.heldEraserUndo = true;

      await selectTool("pen");
      await waitForOverlayInput(primary.id, true);
      try {
        await injectWindowsMouseButton(start.x, start.y, true);
        await injectWindowsMouseMove(end.x, end.y);
        await waitFor(
          async () =>
            Boolean(
              await rebuiltOverlay.webContents.executeJavaScript(
                "Boolean(document.querySelector('[data-active-gesture]'))",
              ),
            ),
          5_000,
          "held pointer gesture starts",
        );
        await shortcutCommand("undo");
        await waitFor(
          async () =>
            !(await rebuiltOverlay.webContents.executeJavaScript(
              "Boolean(document.querySelector('[data-active-gesture]'))",
            )),
          5_000,
          "Ctrl+Z cancels the held gesture",
        );
        if (
          annotationHistory.getSnapshot(primary.id).revision !==
          beforeCancellation.revision
        )
          throw new Error(
            "Undo of an active gesture modified committed history",
          );
      } finally {
        await injectWindowsMouseButton(end.x, end.y, false);
      }

      await selectTool("pen");
      try {
        await injectWindowsMouseButton(start.x, start.y, true);
        await injectWindowsMouseMove(end.x, end.y);
        await injectWindowsShortcut("Escape");
        await waitFor(
          () => context.state().tool === "pass-through",
          5_000,
          "native Escape while dragging",
        );
        await waitForOverlayInput(primary.id, false);
      } finally {
        await injectWindowsMouseButton(end.x, end.y, false);
      }
      if (
        annotationHistory.getSnapshot(primary.id).revision !==
        beforeCancellation.revision
      )
        throw new Error("Escape committed an unfinished stroke");
      await injectWindowsClick(end.x, end.y);
      await waitFor(
        () => clickCount === 2,
        5_000,
        "click-through after held-pointer Escape",
      );
      await selectTool("pen");
      await waitForOverlayInput(primary.id, true);

      await shortcutCommand("clear");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length ===
          beforeStrokes,
        5_000,
        "display clear command",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        false,
        "visual display clear",
      );

      await shortcutCommand("undo");
      await waitFor(
        () =>
          annotationHistory.getSnapshot(primary.id).elements.length ===
          persisted.elements.length,
        5_000,
        "display clear undo",
      );
      await waitForCommittedCanvasInk(
        primary.id,
        true,
        "visual display clear undo",
      );

      await selectTool("pass-through");
      await waitForOverlayInput(primary.id, false);
      await injectWindowsClick(end.x, end.y);
      await waitFor(() => clickCount === 3, 5_000, "restored click-through");
      diagnostics.stress = await measureAnnotationPipeline(
        primary.id,
        start,
        end,
      );
      await verifyShapeAndTextTools(primary.id, start, end);
      await verifySelectionTools(primary.id, start, end);
      diagnostics.resizeTools = await verifySelectionResize({
        history: annotationHistory, publishDocument: context.publishDocument,
        command: shortcutCommand, state: context.state,
      }, primary.id);
      diagnostics.rotationTools = await verifySelectionRotation({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand, state: context.state,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for rotation");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for rotation");
          await waitFor(() => context.state().tool === "select", 5000, "selection for rotation active");
        },
      }, primary.id);
      diagnostics.flipTools = await verifySelectionFlip({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for flip");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for flip");
          await waitFor(() => context.state().tool === "select", 5000, "flip selection active");
        },
      }, primary.id);
      diagnostics.textEditingTools = await verifyExistingTextEditing({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for text editing");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for text editing");
          await waitFor(() => context.state().tool === "select", 5000, "text selection active");
        },
      }, primary.id);
      diagnostics.fillTools = await verifyShapeFill({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand, state: context.state,
      }, primary.id);
      diagnostics.transientTools = await verifyTransientTools({
        history: annotationHistory, state: context.state, publishDocument: context.publishDocument, command: shortcutCommand,
        activateTool: async tool => {
          if (!mainWindow) throw new Error("Missing temporary-tool controller");
          await clickControllerElement(mainWindow, `[data-annotation-tool="${tool}"]`, "temporary tool");
          await waitFor(() => context.state().tool === tool, 5000, "temporary tool state");
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();
      await selectTool("pass-through");
    }
  }

  return { inspectAllRenderers, performInteractionSmoke, diagnostics };
}
