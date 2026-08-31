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
let overlayInteractive = false;
let beforeMainWindowHide: (() => void) | undefined;

export function prepareWindowsForQuit() {
  quitting = true;
}

function applyOverlayInput(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (overlayInteractive) {
    window.setIgnoreMouseEvents(false);
  } else {
    window.setIgnoreMouseEvents(true, { forward: true });
  }
}

function keepOverlayOnTop(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  window.setAlwaysOnTop(true, "screen-saver");
  if (window.isVisible()) window.moveTop();
}

function keepControllerAboveOverlays() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (!overlayInteractive) {
    mainWindow.setAlwaysOnTop(false);
    return;
  }

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  if (mainWindow.isVisible()) mainWindow.moveTop();
}

function restoreWindowOrder() {
  overlayWindows.forEach(keepOverlayOnTop);
  keepControllerAboveOverlays();
}

export function setOverlayInteractive(interactive: boolean) {
  overlayInteractive = interactive;
  overlayWindows.forEach(applyOverlayInput);
  restoreWindowOrder();
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  app.dock?.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  restoreWindowOrder();
}

export function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  beforeMainWindowHide?.();
  mainWindow.hide();
  app.dock?.hide();
}

export function quitApplication() {
  prepareWindowsForQuit();
  app.quit();
}

export function registerOverlayLifecycle() {
  app.on("browser-window-focus", restoreWindowOrder);
  powerMonitor.on("resume", restoreWindowOrder);
  powerMonitor.on("unlock-screen", restoreWindowOrder);
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

export async function createWindow(
  rendererUrl: string | null,
  onBeforeHide?: () => void,
) {
  beforeMainWindowHide = onBeforeHide;
  mainWindow = new BrowserWindow({
    show: false,
    width: 416,
    height: 420,
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
    hideMainWindow();
  });
  mainWindow.on("query-session-end", prepareWindowsForQuit);
  mainWindow.on("closed", () => {
    mainWindow = null;
    beforeMainWindowHide = undefined;
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
      applyOverlayInput(window);
      keepOverlayOnTop(window);
      window.on("show", restoreWindowOrder);
      window.on("always-on-top-changed", (_event, alwaysOnTop) => {
        if (!alwaysOnTop && !quitting) restoreWindowOrder();
      });
      window.webContents.on("did-finish-load", () => {
        window.setContentBounds(bounds);
        window.showInactive();
        restoreWindowOrder();
      });

      await loadRenderer(window, rendererUrl, "/overlay");
    }),
  );

  restoreWindowOrder();
}
