import { app, dialog, Menu, screen, shell } from "electron";

import { setupDevMenu } from "./dev.js";
import { getConnectedDisplays } from "./display.js";
import { startInputCapture, stopInputCapture } from "./input.js";
import { setupIpcHandlers } from "./ipc.js";
import { createSettingsStore } from "./settings.js";
import { closeSplash, createSplash } from "./splash.js";
import { createTray, destroyTray } from "./tray.js";
import {
  createOverlayWindows,
  createWindow,
  mainWindow,
  prepareWindowsForQuit,
  registerOverlayLifecycle,
  showMainWindow,
} from "./window.js";

const isDev = !app.isPackaged;
const rendererUrl = isDev ? "http://127.0.0.1:3000" : null;

function openExternalUrl(url: string) {
  try {
    const target = new URL(url);
    if (target.protocol === "http:" || target.protocol === "https:") {
      void shell.openExternal(target.toString());
    }
  } catch {
    console.error("Invalid external URL:", url);
  }
}

function registerDisplayListeners() {
  const refreshDisplays = async () => {
    try {
      await createOverlayWindows(rendererUrl);
      mainWindow?.webContents.send("displays-updated", getConnectedDisplays());
    } catch (error) {
      console.error("Failed to refresh displays:", error);
    }
  };

  screen.on("display-added", () => void refreshDisplays());
  screen.on("display-removed", () => void refreshDisplays());
  screen.on("display-metrics-changed", () => void refreshDisplays());
}

async function initializeApp() {
  try {
    await app.whenReady();

    const settingsStore = createSettingsStore();
    setupIpcHandlers(settingsStore);
    registerOverlayLifecycle();
    createSplash();

    await createWindow(rendererUrl);
    await createOverlayWindows(rendererUrl);
    startInputCapture();
    createTray();
    registerDisplayListeners();

    if (isDev) {
      setupDevMenu();
    } else {
      Menu.setApplicationMenu(null);
    }
  } catch (error) {
    console.error("Failed to initialize MiniCast:", error);
    closeSplash();
    dialog.showErrorBox(
      "MiniCast 실행 오류",
      `MiniCast를 시작하지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
  }
}

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (url !== contents.getURL()) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
});

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

  void initializeApp();
}
