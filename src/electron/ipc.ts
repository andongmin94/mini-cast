import {
  app,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import { type OverlaySettings } from "./contract.js";
import { getConnectedDisplays } from "./display.js";
import { type SettingsStore } from "./settings.js";
import { mainWindow, overlayDisplays, overlayWindows } from "./window.js";

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents.id === sender.id,
  );
}

function requireMainWindow(event: IpcMainInvokeEvent) {
  if (!isMainWindow(event.sender)) {
    throw new Error("The IPC request did not come from the main window.");
  }
}

function sendOverlayInitialization(
  event: IpcMainEvent,
  settingsStore: SettingsStore,
) {
  const displayIndex = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() && window.webContents.id === event.sender.id,
  );
  const display = overlayDisplays[displayIndex];

  if (!display) {
    return;
  }

  event.sender.send("overlay-init", {
    id: displayIndex,
    width: display.bounds.width,
    height: display.bounds.height,
  });
  event.sender.send("settings-updated", settingsStore.get("settings"));
}

function getRuntimeInfo() {
  const isPortable = Boolean(
    process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR,
  );

  return {
    installMode:
      process.platform !== "win32"
        ? "unknown"
        : isPortable
          ? "portable"
          : app.isPackaged
            ? "msi"
            : "unknown",
    platform: process.platform,
    arch: process.arch,
  };
}

export function setupIpcHandlers(settingsStore: SettingsStore) {
  ipcMain.on("hide-window", (event) => {
    if (isMainWindow(event.sender)) {
      mainWindow?.hide();
    }
  });

  ipcMain.on("minimize-window", (event) => {
    if (isMainWindow(event.sender)) {
      mainWindow?.minimize();
    }
  });

  ipcMain.on("request-displays", (event) => {
    if (isMainWindow(event.sender)) {
      event.sender.send("displays-updated", getConnectedDisplays());
    }
  });

  ipcMain.on("save-settings", (event, settings: OverlaySettings) => {
    if (!isMainWindow(event.sender)) {
      return;
    }

    settingsStore.set("settings", settings);
    overlayWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("settings-updated", settings);
      }
    });
  });

  ipcMain.on("overlay-ready", (event) => {
    sendOverlayInitialization(event, settingsStore);
  });

  ipcMain.handle("get-settings", (event) => {
    requireMainWindow(event);
    return settingsStore.get("settings");
  });

  ipcMain.handle("get-runtime-info", (event) => {
    requireMainWindow(event);
    return getRuntimeInfo();
  });
}
