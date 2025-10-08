import { ipcMain } from "electron";

import { getConnectedDisplays } from "./func.js";
import { adWindow, getMainWindow, getOverlayWindows } from "./window.js";

export function setupIpcHandlers(getStore: any, currentSettings: any) {
  const mainWindow = getMainWindow();

  ipcMain.on("hidden", () => {
    if (adWindow) adWindow.hide();
    mainWindow?.hide();
  });

  ipcMain.on("minimize", () => {
    mainWindow?.minimize();
  });

  // 여기에 다른 IPC 핸들러 추가 가능
  ipcMain.on("request-displays", () => {
    const displays = getConnectedDisplays();
    mainWindow?.webContents.send("displays-updated", displays);
  });

  ipcMain.on("update-settings", (_event, newSettings) => {
    currentSettings = { ...currentSettings, ...newSettings };
    getStore().set("settings", currentSettings);
    getOverlayWindows().forEach((window) => {
      window.webContents.send("update-settings", currentSettings);
    });
  });

  ipcMain.handle("get-value", (event, key) => {
    const value = getStore().get(key);
    return value;
  });
}
