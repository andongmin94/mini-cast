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

function connectedDisplayIds(displays = overlayDisplays) {
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
    if (isMainWindow(event.sender)) mainWindow?.minimize();
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

function syncDisplayState(
  store: SettingsStore,
  displays: readonly OverlayDisplayMeta[],
) {
  displays.forEach((display) => {
    annotationHistory.setDisplayViewport(
      display.id,
      display.bounds.width,
      display.bounds.height,
    );
  });
  const normalized = normalizeOverlaySettings(
    currentSettings,
    displays.map((display) => display.id),
  );
  if (!overlaySettingsEqual(currentSettings, normalized)) {
    currentSettings = normalized;
    scheduleSettingsPersist(store);
  }
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
  cancelActiveAnnotationGestures();
  const displays = getOrderedOverlayDisplays();
  syncDisplayState(store, displays);
  await createOverlayWindows(rendererUrl, displays, overlayCallbacks());
  ensureMainWindowVisible();
  sendSettingsToAll();
  sendAnnotationState();
  sendToWindow(mainWindow, "displays-updated", getConnectedDisplays());
}

function scheduleDisplayRefresh(delayMs = 150) {
  if (!displayRefreshExecutor) return;
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => {
    void displayRefreshExecutor?.request().catch((error) => {
      console.error("Failed to refresh displays:", error);
      setAnnotationTool("pass-through");
    });
  }, delayMs);
}

function registerDisplayEvents(store: SettingsStore) {
  displayRefreshExecutor = new CoalescingSerialExecutor(() => rebuildDisplays(store));
  const refresh = () => scheduleDisplayRefresh();
  screen.on("display-added", refresh);
  screen.on("display-removed", refresh);
  screen.on("display-metrics-changed", refresh);
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

async function performInteractionSmoke() {
  if (process.platform !== "win32") {
    throw new Error("interaction smoke test requires Windows");
  }
  await inspectAllRenderers();

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

  const start = { x: bounds.x + 60, y: bounds.y + 80 };
  const end = { x: bounds.x + width - 60, y: bounds.y + height - 70 };

  try {
    setAnnotationTool("pass-through");
    await waitForOverlayInput(primary.id, false);
    await injectWindowsClick(start.x, start.y);
    await waitFor(() => clickCount === 1, 5_000, "underlay click-through");

    const beforeStrokes = annotationHistory.getSnapshot(primary.id).strokes.length;
    setAnnotationTool("pen");
    await waitForOverlayInput(primary.id, true);
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () => annotationHistory.getSnapshot(primary.id).strokes.length > beforeStrokes,
      5_000,
      "OS-injected annotation stroke",
    );
    if (clickCount !== 1) {
      throw new Error("interactive overlay leaked the pointer to the underlay");
    }

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
  await Promise.race([
    test,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("smoke test timed out")), 30_000);
    }),
  ]);

  await writeSmokeSentinel(smokeOptions.sentinelPath, {
    mode,
    success: true,
    timestamp: new Date().toISOString(),
  });
  console.log(`MiniCast ${mode} smoke test passed`);
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
  syncDisplayState(store, initialDisplays);
  registerIpc(store);
  registerOverlayLifecycle();
  if (!smokeOptions.mode) createSplash();

  await createWindow(rendererUrl, () => setAnnotationTool("pass-through"));
  mainWindow?.webContents.on("did-start-loading", () => {
    controllerSettingsRead = false;
  });
  registerDisplayEvents(store);
  await createOverlayWindows(rendererUrl, initialDisplays, overlayCallbacks());
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
