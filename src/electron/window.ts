import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, powerMonitor } from "electron";

import {
  getOrderedDisplays,
  toOverlayDisplayMeta,
  type OverlayDisplayMeta,
} from "./display.js";
import { closeSplash } from "./splash.js";

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.join(electronDirectory, "../index.html");
const isDev = !app.isPackaged;

export let mainWindow: BrowserWindow | null = null;
export let overlayWindows: BrowserWindow[] = [];
export let overlayDisplays: OverlayDisplayMeta[] = [];

let quitting = false;

export function prepareWindowsForQuit() {
  quitting = true;
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  app.dock?.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

export function quitApplication() {
  prepareWindowsForQuit();
  app.quit();
}

function keepOverlayOnTop(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  window.setAlwaysOnTop(true, "screen-saver");
  if (window.isVisible()) {
    window.moveTop();
  }
}

function keepAllOverlaysOnTop() {
  overlayWindows.forEach(keepOverlayOnTop);
}

export function registerOverlayLifecycle() {
  app.on("browser-window-focus", keepAllOverlaysOnTop);
  powerMonitor.on("resume", keepAllOverlaysOnTop);
  powerMonitor.on("unlock-screen", keepAllOverlaysOnTop);
}

function loadRenderer(
  window: BrowserWindow,
  rendererUrl: string | null,
  route: "/" | "/overlay",
) {
  if (rendererUrl) {
    return window.loadURL(`${rendererUrl}/#${route}`);
  }

  return window.loadFile(rendererFile, { hash: route });
}

export async function createWindow(rendererUrl: string | null) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 416,
    height: 352,
    frame: false,
    resizable: isDev,
    maximizable: isDev,
    icon: path.join(electronDirectory, "../../public/icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(electronDirectory, "preload.cjs"),
    },
  });

  mainWindow.center();
  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash();
    showMainWindow();
  });

  if (process.platform === "win32") {
    mainWindow.on("system-context-menu", (event) => event.preventDefault());
  } else {
    mainWindow.webContents.on("context-menu", (event) =>
      event.preventDefault(),
    );
  }

  mainWindow.on("close", (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
    app.dock?.hide();
  });

  mainWindow.on("query-session-end", prepareWindowsForQuit);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await loadRenderer(mainWindow, rendererUrl, "/");
}

export async function createOverlayWindows(rendererUrl: string | null) {
  overlayWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  });

  const displays = getOrderedDisplays();
  overlayWindows = [];
  overlayDisplays = displays.map(toOverlayDisplayMeta);

  const rendererLoads = displays.map((display) => {
    const bounds = {
      x: Math.round(display.bounds.x),
      y: Math.round(display.bounds.y),
      width: Math.round(display.bounds.width),
      height: Math.round(display.bounds.height),
    };

    const overlayWindow = new BrowserWindow({
      show: false,
      ...bounds,
      useContentSize: true,
      transparent: true,
      frame: false,
      hasShadow: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(electronDirectory, "preload.cjs"),
      },
    });

    overlayWindows.push(overlayWindow);
    overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    overlayWindow.setIgnoreMouseEvents(true, { forward: false });
    keepOverlayOnTop(overlayWindow);

    overlayWindow.on("show", () => keepOverlayOnTop(overlayWindow));
    overlayWindow.on("always-on-top-changed", (_event, alwaysOnTop) => {
      if (!alwaysOnTop && !quitting) {
        keepOverlayOnTop(overlayWindow);
      }
    });

    overlayWindow.webContents.on("did-finish-load", () => {
      // Windows가 투명 창의 초기 bounds를 바꾸는 경우가 있어 로드 후 다시 적용합니다.
      overlayWindow.setContentBounds(bounds);
      setTimeout(() => {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.setContentBounds(bounds);
        }
      }, 0);
      overlayWindow.showInactive();
    });

    return loadRenderer(overlayWindow, rendererUrl, "/overlay");
  });

  await Promise.all(rendererLoads);
}
