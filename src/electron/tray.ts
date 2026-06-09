import path from "path";
import { fileURLToPath } from "url";
import { Menu, nativeImage, Tray } from "electron";

import { mainWindow, quitApplication, showMainWindow } from "./window.js";

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function createTray() {
  if ((tray && !tray.isDestroyed()) || !mainWindow) {
    return;
  }

  try {
    const iconPath = path.join(electronDirectory, "../../public/icon.ico");
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error("Failed to load tray icon:", iconPath);
      return;
    }

    tray = new Tray(icon);
    tray.setToolTip("미니캐스트");
    tray.on("click", showMainWindow);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "열기", type: "normal", click: showMainWindow },
        { type: "separator" },
        { label: "종료", type: "normal", click: quitApplication },
      ]),
    );
  } catch (error) {
    console.error("Failed to create tray:", error);
  }
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}
