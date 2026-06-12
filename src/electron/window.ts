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

export let mainWindow: BrowserWindow | null = null;
export let overlayWindows: BrowserWindow[] = [];
export let overlayDisplays: OverlayDisplayMeta[] = [];

let quitting = false;

export function prepareWindowsForQuit() {
  quitting = true;
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  app.dock?.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function quitApplication() {
  prepareWindowsForQuit();
  app.quit();
}

function keepOverlayOnTop(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  window.setAlwaysOnTop(true, "screen-saver");
  if (window.isVisible()) window.moveTop();
}

export function registerOverlayLifecycle() {
  const restore = () => overlayWindows.forEach(keepOverlayOnTop);
  app.on("browser-window-focus", restore);
  powerMonitor.on("resume", restore);
  powerMonitor.on("unlock-screen", restore);
}

function loadRenderer(
  window: BrowserWindow,
  rendererUrl: string | null,
  route: "/" | "/overlay",
) {
  return rendererUrl
    ? window.loadURL(`${rendererUrl}/#${route}`)
    : window.loadFile(rendererFile, { hash: route });
}

export async function createWindow(rendererUrl: string | null) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 416,
    height: 352,
    frame: false,
    resizable: !app.isPackaged,
    maximizable: !app.isPackaged,
    icon: path.join(electronDirectory, "../../public/icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: path.join(electronDirectory, "preload.cjs"),
    },
  });

  mainWindow.center();
  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash();
    showMainWindow();
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
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
    if (!window.isDestroyed()) window.destroy();
  });

  const displays = getOrderedDisplays();
  overlayWindows = [];
  overlayDisplays = displays.map(toOverlayDisplayMeta);

  await Promise.all(
    displays.map(async (display) => {
      const bounds = {
        x: Math.round(display.bounds.x),
        y: Math.round(display.bounds.y),
        width: Math.round(display.bounds.width),
        height: Math.round(display.bounds.height),
      };
      const window = new BrowserWindow({
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
          sandbox: true,
          webviewTag: false,
          preload: path.join(electronDirectory, "preload.cjs"),
        },
      });

      overlayWindows.push(window);
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setIgnoreMouseEvents(true);
      keepOverlayOnTop(window);
      window.on("show", () => keepOverlayOnTop(window));
      window.on("always-on-top-changed", (_event, alwaysOnTop) => {
        if (!alwaysOnTop && !quitting) keepOverlayOnTop(window);
      });
      window.webContents.on("did-finish-load", () => {
        window.setContentBounds(bounds);
        window.showInactive();
      });

      await loadRenderer(window, rendererUrl, "/overlay");
    }),
  );
}
