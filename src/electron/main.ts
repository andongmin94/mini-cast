import {
  app,
  dialog,
  ipcMain,
  Menu,
  screen,
  type IpcMainEvent,
  type WebContents,
} from "electron";
import Store from "electron-store";

import {
  DEFAULT_OVERLAY_SETTINGS,
  type OverlaySettings,
} from "./contract.js";
import { getConnectedDisplays } from "./display.js";
import { startInputCapture, stopInputCapture } from "./input.js";
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
  showMainWindow,
} from "./window.js";

const rendererUrl = app.isPackaged ? null : "http://127.0.0.1:3000";

type SettingsStore = Store<{ settings: OverlaySettings }>;

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents.id === sender.id,
  );
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
  event.sender.send("settings-updated", store.get("settings"));
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

  ipcMain.on("save-settings", (event, settings: OverlaySettings) => {
    if (!isMainWindow(event.sender)) return;
    store.set("settings", settings);
    overlayWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("settings-updated", settings);
      }
    });
  });

  ipcMain.on("overlay-ready", (event) => initializeOverlay(event, store));

  ipcMain.handle("get-settings", (event) => {
    if (!isMainWindow(event.sender)) {
      throw new Error("Invalid settings request");
    }
    return store.get("settings");
  });
}

function registerDisplayEvents() {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void createOverlayWindows(rendererUrl)
        .then(() => {
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

async function initializeApp() {
  await app.whenReady();

  const store = new Store<{ settings: OverlaySettings }>({
    defaults: { settings: DEFAULT_OVERLAY_SETTINGS },
  });

  registerIpc(store);
  registerOverlayLifecycle();
  createSplash();

  await createWindow(rendererUrl);
  await createOverlayWindows(rendererUrl);
  startInputCapture();
  createTray();
  registerDisplayEvents();

  if (app.isPackaged) Menu.setApplicationMenu(null);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    prepareWindowsForQuit();
    stopInputCapture();
    destroyTray();
  });

  void initializeApp().catch((error) => {
    closeSplash();
    dialog.showErrorBox(
      "MiniCast 실행 오류",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
}
