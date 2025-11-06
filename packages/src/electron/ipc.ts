import { ipcMain } from "electron";

import { getConnectedDisplays } from "./func.js";
import { store } from "./main.js";
import { mainWindow, overlayWindows } from "./window.js";

export function setupIpcHandlers(currentSettings: any) {
  ipcMain.on("hidden", () => {
    mainWindow.hide();
  });

  ipcMain.on("minimize", () => {
    mainWindow.minimize();
  });

  // 여기에 다른 IPC 핸들러 추가 가능
  ipcMain.on("request-displays", () => {
    const displays = getConnectedDisplays();
    mainWindow.webContents.send("displays-updated", displays);
  });

  ipcMain.on("update-settings", (_event: any, newSettings: any) => {
    currentSettings = { ...currentSettings, ...newSettings };
    (store() as any).set("settings", currentSettings);
    overlayWindows.forEach((window: any) => {
      window.webContents.send("update-settings", currentSettings);
    });
  });

  ipcMain.handle("get-value", (_event: any, key: any) => {
    const value = (store() as any).get(key);
    return value;
  });
}
