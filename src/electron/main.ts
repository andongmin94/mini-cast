import {
  app,
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
  AnnotationHistory,
  isAnnotationStroke,
  readAnnotationStrokeIds,
} from "../annotation/history.js";
import {
  DEFAULT_OVERLAY_SETTINGS,
  isAnnotationCommand,
  isAnnotationTool,
  type AnnotationCommand,
  type AnnotationState,
  type AnnotationTool,
  type OverlaySettings,
} from "./contract.js";
import { getConnectedDisplays } from "./display.js";
import {
  setAnnotationInputMode,
  setEmergencyPassThroughHandler,
  startInputCapture,
  stopInputCapture,
} from "./input.js";
import {
  normalizeOverlaySettings,
  overlaySettingsEqual,
} from "./settings.js";
import { closeSplash, createSplash } from "./splash.js";
import { createTray, destroyTray } from "./tray.js";
import {
  createOverlayWindows,
  createWindow,
  hideMainWindow,
  mainWindow,
  overlayDisplays,
  overlayWindows,
  prepareWindowsForQuit,
  registerOverlayLifecycle,
  setOverlayInteractive,
  showMainWindow,
} from "./window.js";

const smokeTest = process.argv.includes("--smoke-test");
const rendererUrl =
  app.isPackaged || smokeTest ? null : "http://127.0.0.1:3000";
const TRANSIENT_ANNOTATION_ACCELERATORS = [
  "Escape",
  "CommandOrControl+Z",
  "CommandOrControl+Shift+Z",
  "Alt+Shift+6",
  "Alt+Shift+7",
];

if (smokeTest) app.disableHardwareAcceleration();

type SettingsStore = Store<{ settings: OverlaySettings }>;

const annotationHistory = new AnnotationHistory();
const activeAnnotationGestures = new Set<number>();
let annotationTool: AnnotationTool = "pass-through";
let lastAnnotationDisplayId: number | null = null;
let controllerSettingsRead = false;
let controllerAnnotationStateRead = false;

function getDisplayCount() {
  return Math.max(overlayDisplays.length, screen.getAllDisplays().length, 1);
}

function readSettings(store: SettingsStore) {
  const saved = store.get("settings");
  const normalized = normalizeOverlaySettings(saved, getDisplayCount());

  if (!overlaySettingsEqual(saved, normalized)) {
    store.set("settings", normalized);
  }

  return normalized;
}

function sendSettingsToOverlays(settings: OverlaySettings) {
  overlayWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("settings-updated", settings);
    }
  });
}

function getAnnotationState(): AnnotationState {
  return { tool: annotationTool };
}

function sendAnnotationState() {
  const state = getAnnotationState();
  mainWindow?.webContents.send("annotation-state-updated", state);
  overlayWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("annotation-state-updated", state);
    }
  });
}

function displayIdForSender(sender: WebContents) {
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() && window.webContents.id === sender.id,
  );
  return index >= 0 ? (overlayDisplays[index]?.id ?? null) : null;
}

function sendAnnotationDocument(displayId: number) {
  const snapshot = annotationHistory.getSnapshot(displayId);
  overlayWindows.forEach((window, index) => {
    if (
      !window.isDestroyed() &&
      overlayDisplays[index]?.id === displayId
    ) {
      window.webContents.send("annotation-document-updated", snapshot);
    }
  });
}

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents.id === sender.id,
  );
}

function isOverlayWindow(sender: WebContents) {
  return displayIdForSender(sender) !== null;
}

function registerShortcut(accelerator: string, callback: () => void) {
  if (globalShortcut.register(accelerator, callback)) return true;
  console.warn(`Global shortcut registration failed: ${accelerator}`);
  return false;
}

function cancelActiveAnnotationGestures() {
  let canceledLiveGesture = false;
  activeAnnotationGestures.forEach((webContentsId) => {
    const target = overlayWindows.find(
      (window) =>
        !window.isDestroyed() && window.webContents.id === webContentsId,
    );
    if (target) {
      canceledLiveGesture = true;
      target.webContents.send("annotation-gesture-cancel");
    }
  });
  activeAnnotationGestures.clear();
  return canceledLiveGesture;
}

function refreshTransientAnnotationShortcuts() {
  TRANSIENT_ANNOTATION_ACCELERATORS.forEach((accelerator) => {
    globalShortcut.unregister(accelerator);
  });
  if (annotationTool === "pass-through") return;

  registerShortcut("Escape", () => setAnnotationTool("pass-through"));
  registerShortcut("CommandOrControl+Z", () =>
    sendAnnotationCommand("undo"),
  );
  registerShortcut("CommandOrControl+Shift+Z", () =>
    sendAnnotationCommand("redo"),
  );
  registerShortcut("Alt+Shift+6", () => sendAnnotationCommand("undo"));
  registerShortcut("Alt+Shift+7", () => sendAnnotationCommand("clear"));
}

function registerAnnotationHotkeys() {
  registerShortcut("Alt+Shift+1", () => setAnnotationTool("pass-through"));
  registerShortcut("Alt+Shift+3", () => setAnnotationTool("pen"));
  registerShortcut("Alt+Shift+4", () => setAnnotationTool("highlighter"));
  registerShortcut("Alt+Shift+5", () => setAnnotationTool("eraser"));
  refreshTransientAnnotationShortcuts();
}

function setAnnotationTool(tool: AnnotationTool) {
  if (tool !== annotationTool) cancelActiveAnnotationGestures();
  annotationTool = tool;
  const interactive = tool !== "pass-through";
  setOverlayInteractive(interactive);
  setAnnotationInputMode(interactive);
  if (!smokeTest) refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function annotationCommandDisplayId() {
  return (
    lastAnnotationDisplayId ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  );
}

function sendAnnotationCommand(command: AnnotationCommand) {
  if (command === "undo" || command === "redo") {
    if (cancelActiveAnnotationGestures()) return;

    const displayId =
      command === "undo"
        ? annotationHistory.undo()
        : annotationHistory.redo();
    if (displayId !== null) sendAnnotationDocument(displayId);
    return;
  }

  cancelActiveAnnotationGestures();
  const displayId = annotationHistory.clearDisplay(annotationCommandDisplayId());
  if (displayId !== null) sendAnnotationDocument(displayId);
}

function initializeOverlay(event: IpcMainEvent, store: SettingsStore) {
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() && window.webContents.id === event.sender.id,
  );
  const display = overlayDisplays[index];
  if (!display) return;

  event.sender.send("overlay-init", {
    id: index,
    displayId: display.id,
    width: display.bounds.width,
    height: display.bounds.height,
  });
  event.sender.send("settings-updated", readSettings(store));
  event.sender.send("annotation-state-updated", getAnnotationState());
  event.sender.send(
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
      event.sender.send("displays-updated", getConnectedDisplays());
    }
  });

  ipcMain.on("save-settings", (event, settings: unknown) => {
    if (
      !isMainWindow(event.sender) ||
      !controllerSettingsRead ||
      !controllerAnnotationStateRead
    ) {
      return;
    }

    const normalized = normalizeOverlaySettings(settings, getDisplayCount());
    store.set("settings", normalized);
    sendSettingsToOverlays(normalized);
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

  ipcMain.on("annotation-add-stroke", (event, stroke: unknown) => {
    const displayId = displayIdForSender(event.sender);
    if (displayId === null || !isAnnotationStroke(stroke)) return;

    lastAnnotationDisplayId = displayId;
    annotationHistory.addStroke(displayId, stroke);
    sendAnnotationDocument(displayId);
  });

  ipcMain.on("annotation-remove-strokes", (event, value: unknown) => {
    const displayId = displayIdForSender(event.sender);
    const ids = readAnnotationStrokeIds(value);
    if (displayId === null || ids === null) return;

    lastAnnotationDisplayId = displayId;
    if (annotationHistory.removeStrokes(displayId, ids) !== null) {
      sendAnnotationDocument(displayId);
    }
  });

  ipcMain.on("annotation-gesture-state", (event, active: unknown) => {
    if (!isOverlayWindow(event.sender) || typeof active !== "boolean") return;

    if (active) {
      activeAnnotationGestures.add(event.sender.id);
      lastAnnotationDisplayId = displayIdForSender(event.sender);
    } else {
      activeAnnotationGestures.delete(event.sender.id);
    }
  });

  ipcMain.on("overlay-ready", (event) => initializeOverlay(event, store));

  ipcMain.handle("get-settings", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid settings request");
    }
    const settings = readSettings(store);
    controllerSettingsRead = true;
    return settings;
  });

  ipcMain.handle("get-annotation-state", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid annotation state request");
    }
    const state = getAnnotationState();
    controllerAnnotationStateRead = true;
    return state;
  });
}

function registerDisplayEvents(store: SettingsStore) {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      cancelActiveAnnotationGestures();
      void createOverlayWindows(rendererUrl)
        .then(() => {
          const settings = readSettings(store);
          sendSettingsToOverlays(settings);
          sendAnnotationState();
          mainWindow?.webContents.send(
            "displays-updated",
            getConnectedDisplays(),
          );
        })
        .catch((error) => console.error("Failed to refresh displays:", error));
    }, 150);
  };

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

async function performSmokeTest() {
  await new Promise((resolve) => setTimeout(resolve, 250));

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("controller window was not created");
  }
  if (!overlayWindows.length) {
    throw new Error("no overlay window was created");
  }
  if (overlayWindows.length !== overlayDisplays.length) {
    throw new Error("overlay window/display counts do not match");
  }

  await inspectRenderer(mainWindow.webContents, "#/");
  await Promise.all(
    overlayWindows.map((window) =>
      inspectRenderer(window.webContents, "#/overlay"),
    ),
  );
}

async function runSmokeTest() {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      performSmokeTest(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("smoke test timed out")),
          15_000,
        );
      }),
    ]);

    console.log("MiniCast smoke test passed");
    prepareWindowsForQuit();
    stopInputCapture();
    app.exit(0);
  } finally {
    clearTimeout(timeout);
  }
}

async function initializeApp() {
  await app.whenReady();

  const store = new Store<{ settings: OverlaySettings }>({
    defaults: { settings: DEFAULT_OVERLAY_SETTINGS },
  });

  readSettings(store);
  registerIpc(store);
  registerOverlayLifecycle();
  setEmergencyPassThroughHandler(() => setAnnotationTool("pass-through"));
  if (!smokeTest) createSplash();

  await createWindow(rendererUrl, () => setAnnotationTool("pass-through"));
  mainWindow?.webContents.on("did-start-loading", () => {
    controllerSettingsRead = false;
    controllerAnnotationStateRead = false;
  });
  await createOverlayWindows(rendererUrl);
  startInputCapture();

  if (smokeTest) {
    await runSmokeTest();
    return;
  }

  registerAnnotationHotkeys();
  createTray();
  registerDisplayEvents(store);

  if (app.isPackaged) Menu.setApplicationMenu(null);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    prepareWindowsForQuit();
    globalShortcut.unregisterAll();
    stopInputCapture();
    destroyTray();
  });

  void initializeApp().catch((error) => {
    closeSplash();

    if (smokeTest) {
      console.error(
        "MiniCast smoke test failed:",
        error instanceof Error ? error.stack : String(error),
      );
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
