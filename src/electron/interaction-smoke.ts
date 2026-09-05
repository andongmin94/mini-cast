import { app, BrowserWindow, screen, type WebContents } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import {
  prepareEraserStroke,
  eraserSweepHitsPreparedStroke,
} from "../annotation/eraser-index.js";
import { eraserSweepHitsStroke } from "../annotation/geometry.js";
import type { AnnotationHistory } from "../annotation/history.js";
import type {
  AnnotationCommand,
  AnnotationState,
  AnnotationTool,
} from "./contract.js";
import type { SettingsWriteState } from "./settings-writer.js";
import {
  ACTIVE_COMMAND_SHORTCUTS,
  TOOL_SHORTCUTS,
} from "./annotation-shortcuts.js";
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
} from "./window.js";

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
    for (let index = 0; index < 1000; index += 1) {
      annotationHistory.addStroke(displayId, {
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
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      if (annotationHistory.getSnapshot(displayId) !== snapshot)
        throw new Error("Stable revision was unnecessarily cloned");
    }
    const cachedSnapshotReads1000Ms = performance.now() - cacheStart;
    const prepareStart = performance.now();
    const prepared = snapshot.strokes.map(prepareEraserStroke);
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
        eraserSweepHitsPreparedStroke(
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
    const referenceIds = snapshot.strokes
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
    await waitFor(
      async () =>
        Number(
          await target.webContents.executeJavaScript(
            "document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationStrokes",
          ),
        ) === snapshot.strokes.length,
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
    const dragStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).strokes.length ===
        snapshot.strokes.length + 1,
      10_000,
      "native drawing still commits over a 128k-point document",
    );
    const nativeDragIncludingInjectionMs = performance.now() - dragStart;
    await shortcutCommand("undo");
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).strokes.length ===
        snapshot.strokes.length,
      10_000,
      "native Undo on the large document",
    );
    await selectTool("eraser");
    await waitForOverlayInput(displayId, true);
    const eraseStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).strokes.length <
        snapshot.strokes.length,
      10_000,
      "native indexed erasing on the 128k-point document",
    );
    const nativeEraseIncludingInjectionMs = performance.now() - eraseStart;
    await shortcutCommand("undo");
    await waitFor(
      () =>
        annotationHistory.getSnapshot(displayId).strokes.length ===
        snapshot.strokes.length,
      10_000,
      "Undo restores every stroke removed by the indexed eraser",
    );
    if (
      JSON.stringify(annotationHistory.getSnapshot(displayId).strokes) !==
      JSON.stringify(snapshot.strokes)
    )
      throw new Error("Large eraser Undo changed the document geometry");
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

      const beforeStrokes = annotationHistory.getSnapshot(primary.id).strokes
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
          annotationHistory.getSnapshot(primary.id).strokes.length >
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
          annotationHistory.getSnapshot(primary.id).strokes.length ===
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
          annotationHistory.getSnapshot(primary.id).strokes.length >
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
          annotationHistory.getSnapshot(primary.id).strokes.length ===
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
          annotationHistory.getSnapshot(primary.id).strokes.length >
          beforeStrokes,
        5_000,
        "eraser undo",
      );
      await waitForCommittedCanvasInk(primary.id, true, "visual eraser undo");

      const penStrokeCount = annotationHistory.getSnapshot(primary.id).strokes
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
          annotationHistory.getSnapshot(primary.id).strokes.length >
          penStrokeCount,
        5_000,
        "OS-injected highlighter stroke",
      );
      const highlighterStrokes = annotationHistory.getSnapshot(
        primary.id,
      ).strokes;
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
          annotationHistory.getSnapshot(primary.id).strokes.length ===
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
                    strokes: Number(root.getAttribute("data-annotation-strokes"))
                  }
                : null;
            })()`,
            true,
          )) as { revision: number; strokes: number } | null;
          return (
            state?.revision === persisted.revision &&
            state.strokes === persisted.strokes.length
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
            && Number(root.dataset.annotationStrokes) === ${persisted.strokes.length};
        })()`);
          return Boolean(restored);
        },
        5_000,
        "real renderer reload restores the document revision and strokes",
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
          annotationHistory.getSnapshot(primary.id).strokes.length ===
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
          annotationHistory.getSnapshot(primary.id).strokes.length ===
          persisted.strokes.length,
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
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();
      await selectTool("pass-through");
    }
  }

  return { inspectAllRenderers, performInteractionSmoke, diagnostics };
}
