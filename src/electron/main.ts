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

let annotationTool: AnnotationTool = "pass-through";
let lastAnnotationOverlayId: number | null = null;

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

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents.id === sender.id,
  );
}

function isOverlayWindow(sender: WebContents) {
  return overlayWindows.some(
    (window) =>
      !window.isDestroyed() && window.webContents.id === sender.id,
  );
}

function registerShortcut(accelerator: string, callback: () => void) {
  if (!globalShortcut.register(accelerator, callback)) {
    console.warn(`Global shortcut registration failed: ${accelerator}`);
  }
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
  annotationTool = tool;
  const interactive = tool !== "pass-through";
  setOverlayInteractive(interactive);
  setAnnotationInputMode(interactive);
  if (!smokeTest) refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function sendAnnotationCommand(command: AnnotationCommand) {
  const liveOverlays = overlayWindows.filter((window) => !window.isDestroyed());
  if (!liveOverlays.length) return;

  const target =
    liveOverlays.find(
      (window) => window.webContents.id === lastAnnotationOverlayId,
    ) ?? liveOverlays[0];
  target.webContents.send("annotation-command", command);
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
    width: display.bounds.width,
    height: display.bounds.height,
  });
  event.sender.send("settings-updated", readSettings(store));
  event.sender.send("annotation-state-updated", getAnnotationState());
}

function registerIpc(store: SettingsStore) {
  ipcMain.on("minimize-window", (event) => {
    if (isMainWindow(event.sender)) mainWindow?.minimize();
  });

  ipcMain.on("hide-window", (event) => {
    if (isMainWindow(event.sender)) mainWindow?.hide();
  });

  ipcMain.on("request-displays", (event) => {
    if (isMainWindow(event.sender)) {
      event.sender.send("displays-updated", getConnectedDisplays());
    }
  });

  ipcMain.on("save-settings", (event, settings: unknown) => {
    if (!isMainWindow(event.sender)) return;

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

  ipcMain.on("annotation-interaction", (event) => {
    if (isOverlayWindow(event.sender)) {
      lastAnnotationOverlayId = event.sender.id;
    }
  });

  ipcMain.on("overlay-ready", (event) => initializeOverlay(event, store));

  ipcMain.handle("get-settings", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid settings request");
    }
    return readSettings(store);
  });

  ipcMain.handle("get-annotation-state", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid annotation state request");
    }
    return getAnnotationState();
  });
}

function registerDisplayEvents(store: SettingsStore) {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void createOverlayWindows(rendererUrl)
        .then(() => {
          lastAnnotationOverlayId = null;
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
  if (!smokeTest) createSplash();

  await createWindow(rendererUrl);
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
