import path from "path";
import { app, BrowserWindow } from "electron";
import {
  getOrderedDisplays,
  toOverlayDisplayMeta,
  type OverlayDisplayMeta,
} from "./display.js";
import { mouseEventInterval } from "./func.js";
import { __dirname, currentSettings, isDev } from "./main.js";
import { closeSplash } from "./splash.js";

export let mainWindow: BrowserWindow | null = null;
export let overlayWindows: BrowserWindow[] = [];
export let overlayDisplays: OverlayDisplayMeta[] = [];

export async function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 416,
    height: 352,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash();
    mainWindow?.show();
  });

  if (process.platform === "win32") {
    mainWindow.on("system-context-menu", (event: any) => {
      event.preventDefault();
    });
  } else {
    mainWindow.webContents.on("context-menu", (event: any) => {
      console.log("Main process context-menu event triggered on macOS/Linux");
      event.preventDefault();
    });
  }

  mainWindow.on("close", (e: any) => {
    if (process.platform === "darwin") {
      e.preventDefault();
      mainWindow?.hide();
      app.dock?.hide();
    } else {
      clearInterval(mouseEventInterval);
      app.quit();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

export function createOverlayWindows(port: number) {
  overlayWindows.forEach((window) => window.close());
  overlayWindows = [];
  overlayDisplays = [];

  const displays = getOrderedDisplays();
  overlayDisplays = displays.map((display) => toOverlayDisplayMeta(display));

  displays.forEach((display, index) => {
    const overlayBounds = {
      x: Math.round(display.bounds.x),
      y: Math.round(display.bounds.y),
      width: Math.round(display.bounds.width),
      height: Math.round(display.bounds.height),
    };

    const overlayWindow = new BrowserWindow({
      x: overlayBounds.x,
      y: overlayBounds.y,
      width: overlayBounds.width,
      height: overlayBounds.height,
      useContentSize: true,
      transparent: true,
      frame: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });

    const applyOverlayBounds = () => {
      if (overlayWindow.isDestroyed()) {
        return;
      }

      overlayWindow.setContentBounds(overlayBounds);

      setTimeout(() => {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.setContentBounds(overlayBounds);
        }
      }, 0);
    };

    overlayWindow.loadURL(`http://localhost:${port}/overlay`);
    overlayWindows.push(overlayWindow);

    overlayWindow.webContents.on("did-finish-load", () => {
      applyOverlayBounds();

      overlayWindow.webContents.send("init", {
        id: index,
        ...overlayBounds,
        scaleFactor: display.scaleFactor,
      });

      overlayWindow.webContents.send("update-settings", currentSettings);
    });

    overlayWindow.setIgnoreMouseEvents(true, { forward: false });
  });
}