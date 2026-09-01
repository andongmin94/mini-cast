import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  type IpcMainEvent,
  type WebContents,
} from "electron";
import Store from "electron-store";

import {
  GestureLeaseRegistry,
  isGestureId,
} from "../annotation/gesture-leases.js";
import {
  AnnotationHistory,
  isAnnotationStroke,
  readAnnotationStrokeIds,
} from "../annotation/history.js";
import {
  ACTIVE_COMMAND_SHORTCUTS,
  ESCAPE_SHORTCUT,
  TOOL_SHORTCUTS,
} from "./annotation-shortcuts.js";
import {
  DEFAULT_OVERLAY_SETTINGS,
  isAnnotationCommand,
  isAnnotationTool,
  type AnnotationCommand,
  type AnnotationState,
  type AnnotationTool,
  type OverlaySettings,
} from "./contract.js";
import {
  getConnectedDisplays,
  getOrderedOverlayDisplays,
  type OverlayDisplayMeta,
} from "./display.js";
import {
  configureToolShortcutFallbacks,
  refreshCursorCapture,
  setAnnotationInputMode,
  startInputCapture,
  stopInputCapture,
} from "./input.js";
import { sendToWebContents, sendToWindow } from "./ipc.js";
import { CoalescingSerialExecutor } from "./serial-executor.js";
import {
  injectWindowsClick,
  injectWindowsDrag,
  readSmokeOptions,
  waitFor,
  writeSmokeSentinel,
} from "./smoke.js";
import {
  normalizeOverlaySettings,
  overlaySettingsEqual,
} from "./settings.js";
import { closeSplash, createSplash } from "./splash.js";
import { createTray, destroyTray } from "./tray.js";
import {
  createOverlayWindows,
  createWindow,
  ensureMainWindowVisible,
  hideMainWindow,
  mainWindow,
  overlayDisplays,
  overlayWindows,
  prepareWindowsForQuit,
  registerOverlayLifecycle,
  setOverlayInteractive,
  showMainWindow,
} from "./window.js";

const smokeOptions = readSmokeOptions(process.argv);
const rendererUrl =
  app.isPackaged || smokeOptions.mode ? null : "http://127.0.0.1:3000";

if (smokeOptions.mode) app.disableHardwareAcceleration();

type SettingsStore = Store<{ settings: OverlaySettings }>;

const annotationHistory = new AnnotationHistory();
const gestureLeases = new GestureLeaseRegistry();
const unavailableShortcuts = new Set<string>();
let annotationTool: AnnotationTool = "pass-through";
let controllerSettingsRead = false;
let currentSettings = DEFAULT_OVERLAY_SETTINGS;
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettingsStore: SettingsStore | null = null;
let displayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let displayRefreshExecutor: CoalescingSerialExecutor | null = null;
let displayRebuildInProgress = false;
let shuttingDown = false;

function connectedDisplayIds(
  displays: readonly OverlayDisplayMeta[] = overlayDisplays,
) {
  return displays.map((display) => display.id);
}

function persistSettingsNow() {
  if (!pendingSettingsStore) return;
  pendingSettingsStore.set("settings", currentSettings);
  pendingSettingsStore = null;
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = undefined;
}

function scheduleSettingsPersist(store: SettingsStore) {
  pendingSettingsStore = store;
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(persistSettingsNow, 150);
}

function readInitialSettings(
  store: SettingsStore,
  displays: readonly OverlayDisplayMeta[],
) {
  const saved = store.get("settings");
  const normalized = normalizeOverlaySettings(saved, connectedDisplayIds(displays));
  if (!overlaySettingsEqual(saved, normalized)) store.set("settings", normalized);
  return normalized;
}

function sendSettingsToOverlays() {
  overlayWindows.forEach((window) => {
    sendToWindow(window, "settings-updated", currentSettings);
  });
}

function sendSettingsToAll() {
  sendToWindow(mainWindow, "settings-updated", currentSettings);
  sendSettingsToOverlays();
}

function getAnnotationState(): AnnotationState {
  return {
    tool: annotationTool,
    unavailableShortcuts: [...unavailableShortcuts].sort(),
  };
}

function sendAnnotationState() {
  const state = getAnnotationState();
  sendToWindow(mainWindow, "annotation-state-updated", state);
  overlayWindows.forEach((window) => {
    sendToWindow(window, "annotation-state-updated", state);
  });
}

function displayIdForSender(sender: WebContents) {
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      window.webContents.id === sender.id,
  );
  return index >= 0 ? (overlayDisplays[index]?.id ?? null) : null;
}

function sendAnnotationDocument(displayId: number) {
  const snapshot = annotationHistory.getSnapshot(displayId);
  overlayWindows.forEach((window, index) => {
    if (overlayDisplays[index]?.id === displayId) {
      sendToWindow(window, "annotation-document-updated", snapshot);
    }
  });
}

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === sender.id,
  );
}

function registerShortcut(accelerator: string, callback: () => void) {
  globalShortcut.unregister(accelerator);
  const registered = globalShortcut.register(accelerator, callback);
  if (registered) unavailableShortcuts.delete(accelerator);
  else {
    unavailableShortcuts.add(accelerator);
    console.warn(`Global shortcut registration failed: ${accelerator}`);
  }
  return registered;
}

function cancelActiveAnnotationGestures() {
  const canceled = gestureLeases.cancelAll();
  canceled.forEach(({ ownerId, gestureId }) => {
    const target = overlayWindows.find(
      (window) =>
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        window.webContents.id === ownerId,
    );
    sendToWindow(target, "annotation-gesture-cancel", gestureId);
  });
  return canceled.length > 0;
}

function refreshTransientAnnotationShortcuts() {
  const transient = [
    ESCAPE_SHORTCUT,
    ...ACTIVE_COMMAND_SHORTCUTS.map((shortcut) => shortcut.accelerator),
  ];
  transient.forEach((accelerator) => {
    globalShortcut.unregister(accelerator);
    unavailableShortcuts.delete(accelerator);
  });
  if (annotationTool === "pass-through") return;

  registerShortcut(ESCAPE_SHORTCUT, () => setAnnotationTool("pass-through"));
  ACTIVE_COMMAND_SHORTCUTS.forEach(({ accelerator, command }) => {
    registerShortcut(accelerator, () => sendAnnotationCommand(command));
  });
}

function registerAnnotationHotkeys() {
  const fallbackCombinations: string[] = [];
  TOOL_SHORTCUTS.forEach(({ accelerator, inputCombination, tool }) => {
    if (!registerShortcut(accelerator, () => setAnnotationTool(tool))) {
      fallbackCombinations.push(inputCombination);
    }
  });
  configureToolShortcutFallbacks(fallbackCombinations, (combination) => {
    const shortcut = TOOL_SHORTCUTS.find(
      (candidate) => candidate.inputCombination === combination,
    );
    if (shortcut) setAnnotationTool(shortcut.tool);
  });
  refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function setAnnotationTool(tool: AnnotationTool) {
  if (tool !== annotationTool) cancelActiveAnnotationGestures();
  annotationTool = tool;
  const interactive = tool !== "pass-through";
  setOverlayInteractive(interactive);
  setAnnotationInputMode(interactive);
  if (!smokeOptions.mode) refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function annotationCommandDisplayId() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
}

function sendAnnotationCommand(command: AnnotationCommand) {
  if (displayRebuildInProgress) return;

  if (command === "undo" || command === "redo") {
    if (cancelActiveAnnotationGestures()) return;

    const displayId =
      command === "undo" ? annotationHistory.undo() : annotationHistory.redo();
    if (displayId !== null) sendAnnotationDocument(displayId);
    return;
  }

  cancelActiveAnnotationGestures();
  const displayId = annotationHistory.clearDisplay(annotationCommandDisplayId());
  if (displayId !== null) sendAnnotationDocument(displayId);
}

function initializeOverlay(event: IpcMainEvent) {
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      window.webContents.id === event.sender.id,
  );
  const display = overlayDisplays[index];
  if (!display) return;

  sendToWebContents(event.sender, "overlay-init", {
    displayId: display.id,
    width: display.bounds.width,
    height: display.bounds.height,
  });
  sendToWebContents(event.sender, "settings-updated", currentSettings);
  sendToWebContents(event.sender, "annotation-state-updated", getAnnotationState());
  sendToWebContents(
    event.sender,
    "annotation-document-updated",
    annotationHistory.getSnapshot(display.id),
  );
}

function registerIpc(store: SettingsStore) {
  ipcMain.on("minimize-window", (event) => {
    if (!isMainWindow(event.sender)) return;
    setAnnotationTool("pass-through");
    mainWindow?.minimize();
  });

  ipcMain.on("hide-window", (event) => {
    if (isMainWindow(event.sender)) hideMainWindow();
  });

  ipcMain.on("request-displays", (event) => {
    if (isMainWindow(event.sender)) {
      sendToWebContents(event.sender, "displays-updated", getConnectedDisplays());
    }
  });

  ipcMain.on("save-settings", (event, settings: unknown) => {
    if (!isMainWindow(event.sender) || !controllerSettingsRead) return;

    currentSettings = normalizeOverlaySettings(settings, connectedDisplayIds());
    sendSettingsToOverlays();
    scheduleSettingsPersist(store);
  });

  ipcMain.on("set-annotation-tool", (event, tool: unknown) => {
    if (isMainWindow(event.sender) && isAnnotationTool(tool)) {
      setAnnotationTool(tool);
    }
  });

  ipcMain.on("annotation-command", (event, command: unknown) => {
    if (isMainWindow(event.sender) && isAnnotationCommand(command)) {
      sendAnnotationCommand(command);
    }
  });

  ipcMain.on("annotation-gesture-begin", (event, gestureId: unknown) => {
    const displayId = displayIdForSender(event.sender);
    if (
      displayId === null ||
      displayRebuildInProgress ||
      annotationTool === "pass-through" ||
      !isGestureId(gestureId)
    ) {
      return;
    }

    const previous = gestureLeases.begin(event.sender.id, gestureId);
    if (previous && previous !== gestureId) {
      sendToWebContents(event.sender, "annotation-gesture-cancel", previous);
    }
  });

  ipcMain.handle(
    "annotation-add-stroke",
    (event, gestureId: unknown, stroke: unknown) => {
      const displayId = displayIdForSender(event.sender);
      if (
        displayId === null ||
        displayRebuildInProgress ||
        !isGestureId(gestureId) ||
        !gestureLeases.matches(event.sender.id, gestureId) ||
        !isAnnotationStroke(stroke)
      ) {
        return false;
      }

      try {
        annotationHistory.addStroke(displayId, stroke);
        gestureLeases.end(event.sender.id, gestureId);
        sendAnnotationDocument(displayId);
        return true;
      } catch {
        gestureLeases.end(event.sender.id, gestureId);
        return false;
      }
    },
  );

  ipcMain.handle(
    "annotation-remove-strokes",
    (event, gestureId: unknown, value: unknown) => {
      const displayId = displayIdForSender(event.sender);
      const ids = readAnnotationStrokeIds(value);
      if (
        displayId === null ||
        displayRebuildInProgress ||
        !isGestureId(gestureId) ||
        !gestureLeases.matches(event.sender.id, gestureId) ||
        ids === null
      ) {
        return false;
      }

      gestureLeases.end(event.sender.id, gestureId);
      const changedDisplayId = annotationHistory.removeStrokes(displayId, ids);
      if (changedDisplayId !== null) sendAnnotationDocument(changedDisplayId);
      return changedDisplayId !== null;
    },
  );

  ipcMain.on("annotation-gesture-end", (event, gestureId: unknown) => {
    if (isGestureId(gestureId)) gestureLeases.end(event.sender.id, gestureId);
  });

  ipcMain.on("overlay-ready", (event) => initializeOverlay(event));

  ipcMain.handle("get-settings", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid settings request");
    }
    controllerSettingsRead = true;
    return currentSettings;
  });

  ipcMain.handle("get-annotation-state", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid annotation state request");
    }
    return getAnnotationState();
  });
}

function prepareDisplayHistory(displays: readonly OverlayDisplayMeta[]) {
  displays.forEach((display) => {
    annotationHistory.setDisplayViewport(
      display.id,
      display.bounds.width,
      display.bounds.height,
    );
  });
}

function commitDisplaySettings(
  store: SettingsStore,
  nextSettings: OverlaySettings,
) {
  if (overlaySettingsEqual(currentSettings, nextSettings)) return;
  currentSettings = nextSettings;
  scheduleSettingsPersist(store);
}

function overlayCallbacks() {
  return {
    onOverlayGone(webContentsId: number) {
      gestureLeases.removeOwner(webContentsId);
    },
    onOverlayInvalidated() {
      scheduleDisplayRefresh(0);
    },
  };
}

async function rebuildDisplays(store: SettingsStore) {
  if (shuttingDown) return;

  displayRebuildInProgress = true;
  cancelActiveAnnotationGestures();
  const displays = getOrderedOverlayDisplays();
  const historyCheckpoint = annotationHistory.clone();

  try {
    prepareDisplayHistory(displays);
    await createOverlayWindows(rendererUrl, displays, overlayCallbacks());
    if (shuttingDown) return;

    const nextSettings = normalizeOverlaySettings(
      currentSettings,
      displays.map((display) => display.id),
    );
    commitDisplaySettings(store, nextSettings);
    ensureMainWindowVisible();
    sendSettingsToAll();
    sendAnnotationState();
    displays.forEach((display) => sendAnnotationDocument(display.id));
    refreshCursorCapture();
    sendToWindow(mainWindow, "displays-updated", getConnectedDisplays());
  } catch (error) {
    annotationHistory.restoreFrom(historyCheckpoint);
    const restoredSettings = normalizeOverlaySettings(
      currentSettings,
      connectedDisplayIds(),
    );
    commitDisplaySettings(store, restoredSettings);
    sendSettingsToAll();
    sendAnnotationState();
    refreshCursorCapture();
    throw error;
  } finally {
    displayRebuildInProgress = false;
  }
}

function stopDisplayRefresh() {
  shuttingDown = true;
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = undefined;
  displayRefreshExecutor = null;
}

function scheduleDisplayRefresh(delayMs = 150) {
  if (shuttingDown || !displayRefreshExecutor) return;
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => {
    displayRefreshTimer = undefined;
    if (shuttingDown) return;
    void displayRefreshExecutor?.request().catch((error) => {
      console.error("Failed to refresh displays:", error);
      setAnnotationTool("pass-through");
    });
  }, delayMs);
}

function registerDisplayEvents(store: SettingsStore) {
  const executor = new CoalescingSerialExecutor(() => rebuildDisplays(store));
  displayRefreshExecutor = executor;
  const refresh = () => scheduleDisplayRefresh();
  screen.on("display-added", refresh);
  screen.on("display-removed", refresh);
  screen.on("display-metrics-changed", refresh);
  return executor;
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
  if (!overlayWindows.length) throw new Error("no overlay window was created");

  await inspectRenderer(mainWindow.webContents, "#/");
  await Promise.all(
    overlayWindows.map((window) => inspectRenderer(window.webContents, "#/overlay")),
  );
}

async function verifyControllerAnnotationToolWiring() {
  const controller = mainWindow;
  if (!controller || controller.isDestroyed()) {
    throw new Error("controller window was not created");
  }

  const clickButton = async (label: string, titlePrefix = "") => {
    const encodedLabel = JSON.stringify(label);
    const encodedTitlePrefix = JSON.stringify(titlePrefix);
    await waitFor(
      async () =>
        (await controller.webContents.executeJavaScript(
          `(() => {
            const buttons = [...document.querySelectorAll("button")];
            const target = buttons.find((button) => {
              const textMatches = button.textContent?.trim() === ${encodedLabel};
              const prefix = ${encodedTitlePrefix};
              const titleMatches = prefix
                ? button.getAttribute("title")?.startsWith(prefix)
                : true;
              return textMatches && titleMatches;
            });
            target?.click();
            return Boolean(target);
          })()`,
          true,
        )) as boolean,
      2_000,
      `controller button: ${label}`,
    );
  };

  await clickButton("판서");
  await clickButton("펜", "펜 (");
  await waitFor(() => annotationTool === "pen", 2_000, "controller pen tool IPC");
  await clickButton("조작", "조작 (");
  await waitFor(
    () => annotationTool === "pass-through",
    2_000,
    "controller pass-through IPC",
  );
}

async function waitForOverlayInput(displayId: number, interactive: boolean) {
  const index = overlayDisplays.findIndex((display) => display.id === displayId);
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
      return interactive ? pointerEvents === "auto" : pointerEvents === "none";
    },
    5_000,
    interactive ? "interactive overlay" : "click-through overlay",
  );
}

async function committedCanvasInkPixels(displayId: number) {
  const index = overlayDisplays.findIndex((display) => display.id === displayId);
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
  await waitFor(async () => {
    const pixels = await committedCanvasInkPixels(displayId);
    return expected ? pixels > 0 : pixels === 0;
  }, 5_000, description);
}

async function performInteractionSmoke() {
  if (process.platform !== "win32") {
    throw new Error("interaction smoke test requires Windows");
  }
  await inspectAllRenderers();
  await verifyControllerAnnotationToolWiring();

  setAnnotationTool("pen");
  hideMainWindow();
  if (annotationTool !== "pass-through") {
    throw new Error("hiding the controller did not restore click-through");
  }
  showMainWindow();
  setAnnotationTool("pen");
  mainWindow?.minimize();
  await waitFor(
    () => annotationTool === "pass-through",
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
    setAnnotationTool("pass-through");
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

    const beforeStrokes = annotationHistory.getSnapshot(primary.id).strokes.length;
    await waitForCommittedCanvasInk(
      primary.id,
      false,
      "an initially empty annotation canvas",
    );

    setAnnotationTool("pen");
    await waitForOverlayInput(primary.id, true);
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length > beforeStrokes,
      5_000,
      "OS-injected annotation stroke",
    );
    await waitForCommittedCanvasInk(
      primary.id,
      true,
      "visible committed pen pixels",
    );
    if (clickCount !== 1) {
      throw new Error("interactive overlay leaked the pointer to the underlay");
    }

    sendAnnotationCommand("undo");
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length === beforeStrokes,
      5_000,
      "annotation undo",
    );
    await waitForCommittedCanvasInk(primary.id, false, "visual annotation undo");

    sendAnnotationCommand("redo");
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length > beforeStrokes,
      5_000,
      "annotation redo",
    );
    await waitForCommittedCanvasInk(primary.id, true, "visual annotation redo");

    setAnnotationTool("eraser");
    await waitForOverlayInput(primary.id, true);
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length === beforeStrokes,
      5_000,
      "OS-injected eraser gesture",
    );
    await waitForCommittedCanvasInk(primary.id, false, "visual eraser result");

    sendAnnotationCommand("undo");
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length > beforeStrokes,
      5_000,
      "eraser undo",
    );
    await waitForCommittedCanvasInk(primary.id, true, "visual eraser undo");

    const penStrokeCount = annotationHistory.getSnapshot(primary.id).strokes.length;
    setAnnotationTool("highlighter");
    await waitForOverlayInput(primary.id, true);
    await injectWindowsDrag(
      highlighterStart.x,
      highlighterStart.y,
      highlighterEnd.x,
      highlighterEnd.y,
    );
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length > penStrokeCount,
      5_000,
      "OS-injected highlighter stroke",
    );
    const highlighterStrokes = annotationHistory.getSnapshot(primary.id).strokes;
    const highlighter = highlighterStrokes[highlighterStrokes.length - 1];
    if (highlighter?.tool !== "highlighter" || highlighter.opacity !== 0.35) {
      throw new Error("highlighter stroke style was not committed correctly");
    }
    await waitForCommittedCanvasInk(primary.id, true, "visible highlighter pixels");

    sendAnnotationCommand("undo");
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length === penStrokeCount,
      5_000,
      "highlighter undo",
    );

    const persisted = annotationHistory.getSnapshot(primary.id);
    if (!displayRefreshExecutor) {
      throw new Error("display refresh executor was not initialized");
    }
    await Promise.all([
      displayRefreshExecutor.request(),
      displayRefreshExecutor.request(),
    ]);
    await inspectAllRenderers();
    await waitForOverlayInput(primary.id, true);

    const rebuiltIndex = overlayDisplays.findIndex(
      (display) => display.id === primary.id,
    );
    const rebuiltOverlay = overlayWindows[rebuiltIndex];
    if (!rebuiltOverlay) throw new Error("rebuilt primary overlay was not found");
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

    sendAnnotationCommand("clear");
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length === beforeStrokes,
      5_000,
      "display clear command",
    );
    await waitForCommittedCanvasInk(primary.id, false, "visual display clear");

    sendAnnotationCommand("undo");
    await waitFor(
      () =>
        annotationHistory.getSnapshot(primary.id).strokes.length ===
        persisted.strokes.length,
      5_000,
      "display clear undo",
    );
    await waitForCommittedCanvasInk(primary.id, true, "visual display clear undo");

    setAnnotationTool("pass-through");
    await waitForOverlayInput(primary.id, false);
    await injectWindowsClick(end.x, end.y);
    await waitFor(() => clickCount === 2, 5_000, "restored click-through");
  } finally {
    if (!underlay.isDestroyed()) underlay.destroy();
    setAnnotationTool("pass-through");
  }
}

async function runSmokeTest() {
  const mode = smokeOptions.mode;
  if (!mode) return;

  const test = mode === "interaction" ? performInteractionSmoke() : inspectAllRenderers();
  const timeoutMs = mode === "interaction" ? 60_000 : 30_000;
  await Promise.race([
    test,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("smoke test timed out")), timeoutMs);
    }),
  ]);

  await writeSmokeSentinel(smokeOptions.sentinelPath, {
    mode,
    success: true,
    timestamp: new Date().toISOString(),
  });
  console.log(`MiniCast ${mode} smoke test passed`);
  stopDisplayRefresh();
  prepareWindowsForQuit();
  stopInputCapture();
  app.exit(0);
}

async function initializeApp() {
  await app.whenReady();

  const store = new Store<{ settings: OverlaySettings }>({
    defaults: { settings: DEFAULT_OVERLAY_SETTINGS },
  });
  const initialDisplays = getOrderedOverlayDisplays();
  currentSettings = readInitialSettings(store, initialDisplays);
  registerIpc(store);
  registerOverlayLifecycle();
  if (!smokeOptions.mode) createSplash();

  await createWindow(rendererUrl, () => setAnnotationTool("pass-through"));
  mainWindow?.webContents.on("did-start-loading", () => {
    controllerSettingsRead = false;
  });
  mainWindow?.webContents.on("render-process-gone", (_event, details) => {
    if (shuttingDown || details.reason === "clean-exit") return;
    setAnnotationTool("pass-through");
    mainWindow?.webContents.reload();
  });
  const displayExecutor = registerDisplayEvents(store);
  await displayExecutor.request();
  startInputCapture();

  if (smokeOptions.mode) {
    await runSmokeTest();
    return;
  }

  registerAnnotationHotkeys();
  createTray();
  ensureMainWindowVisible();

  if (app.isPackaged) Menu.setApplicationMenu(null);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    stopDisplayRefresh();
    prepareWindowsForQuit();
    persistSettingsNow();
    globalShortcut.unregisterAll();
    stopInputCapture();
    destroyTray();
  });

  void initializeApp().catch(async (error) => {
    closeSplash();

    if (smokeOptions.mode) {
      console.error(
        `MiniCast ${smokeOptions.mode} smoke test failed:`,
        error instanceof Error ? error.stack : String(error),
      );
      await writeSmokeSentinel(smokeOptions.sentinelPath, {
        mode: smokeOptions.mode,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      stopDisplayRefresh();
      prepareWindowsForQuit();
      stopInputCapture();
      app.exit(1);
      return;
    }

    dialog.showErrorBox(
      "MiniCast 실행 오류",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
}
