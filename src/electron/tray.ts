import path from "path";
import { fileURLToPath } from "url";
import { Menu, nativeImage, Tray } from "electron";

import { mainWindow, quitApplication, showMainWindow } from "./window.js";

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
let tray: Tray | null = null;

export function createTray() {
  if (tray || !mainWindow) return;

  const icon = nativeImage.createFromPath(
    path.join(electronDirectory, "../../public/icon.ico"),
  );
  if (icon.isEmpty()) return;

  tray = new Tray(icon);
  tray.setToolTip("미니캐스트");
  tray.on("click", showMainWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "열기", click: showMainWindow },
      { type: "separator" },
      { label: "종료", click: quitApplication },
    ]),
  );
}

export function isTrayReady() {
  return tray !== null && !tray.isDestroyed();
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}
