import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, powerMonitor, screen } from "electron";

import {
  getOrderedOverlayDisplays,
  type OverlayDisplayMeta,
} from "./display.js";
import { closeSplash } from "./splash.js";
import { fitWindowToWorkAreas } from "./window-layout.js";

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.join(electronDirectory, "../index.html");

export let mainWindow: BrowserWindow | null = null;
export let overlayWindows: BrowserWindow[] = [];
export let overlayDisplays: OverlayDisplayMeta[] = [];

let quitting = false;
let overlayInteractive = false;
let beforeMainWindowHide: (() => void) | undefined;
const intentionallyClosingOverlayContents = new Set<number>();

export interface OverlayWindowCallbacks {
  onOverlayGone?(webContentsId: number): void;
  onOverlayInvalidated?(): void;
}

export function prepareWindowsForQuit() {
  quitting = true;
}

function applyOverlayInput(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  try {
    if (overlayInteractive) {
      window.setIgnoreMouseEvents(false);
    } else {
      window.setIgnoreMouseEvents(true, { forward: true });
    }
  } catch {
    // A renderer can disappear between the destroyed check and the native call.
  }
}

function keepOverlayOnTop(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  try {
    window.setAlwaysOnTop(true, "screen-saver");
    if (window.isVisible()) window.moveTop();
  } catch {
    // Window teardown is asynchronous on Windows.
  }
}

function keepControllerAboveOverlays() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    if (!overlayInteractive) {
      mainWindow.setAlwaysOnTop(false);
      return;
    }

    mainWindow.setAlwaysOnTop(true, "screen-saver");
    if (mainWindow.isVisible()) mainWindow.moveTop();
  } catch {
    // Ignore native ordering failures during shutdown/rebuild.
  }
}

export function restoreWindowOrder() {
  overlayWindows.forEach(keepOverlayOnTop);
  keepControllerAboveOverlays();
}

export function setOverlayInteractive(interactive: boolean) {
  overlayInteractive = interactive;
  overlayWindows.forEach(applyOverlayInput);
  restoreWindowOrder();
}

export function isOverlayInteractive() {
  return overlayInteractive;
}

export function ensureMainWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const displays = screen.getAllDisplays();
  if (!displays.length) return;
  const next = fitWindowToWorkAreas(
    mainWindow.getBounds(),
    displays.map((display) => ({ id: display.id, ...display.workArea })),
    screen.getPrimaryDisplay().id,
  );
  mainWindow.setBounds(next, false);
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  app.dock?.show();
  ensureMainWindowVisible();
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
  mainWindow.on("always-on-top-changed", (_event, alwaysOnTop) => {
    if (overlayInteractive && !alwaysOnTop && !quitting) restoreWindowOrder();
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

function destroyOverlayWindows(windows: readonly BrowserWindow[]) {
  windows.forEach((window) => {
    if (window.isDestroyed()) return;
    try {
      intentionallyClosingOverlayContents.add(window.webContents.id);
      window.setIgnoreMouseEvents(true, { forward: true });
      window.destroy();
    } catch {
      // Ignore a concurrent renderer/native teardown.
    }
  });
}

export async function createOverlayWindows(
  rendererUrl: string | null,
  displays: readonly OverlayDisplayMeta[] = getOrderedOverlayDisplays(),
  callbacks: OverlayWindowCallbacks = {},
) {
  const previousWindows = [...overlayWindows];
  const previousEntries = previousWindows
    .map((window, index) => ({ window, display: overlayDisplays[index] }))
    .filter(
      (entry): entry is { window: BrowserWindow; display: OverlayDisplayMeta } =>
        Boolean(entry.display),
    );

  previousWindows.forEach((window) => {
    if (window.isDestroyed()) return;
    try {
      window.setIgnoreMouseEvents(true, { forward: true });
    } catch {
      // The previous generation may already be tearing down.
    }
  });

  const nextDisplays = displays.map((display) => ({
    id: display.id,
    bounds: { ...display.bounds },
  }));
  let nextWindows: BrowserWindow[] = [];

  try {
    if (!nextDisplays.length) {
      throw new Error("No displays are available for overlay creation.");
    }

    for (const display of nextDisplays) {
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
      nextWindows.push(window);
      const webContentsId = window.webContents.id;

      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      applyOverlayInput(window);
      keepOverlayOnTop(window);
      window.on("show", restoreWindowOrder);
      window.on("always-on-top-changed", (_event, alwaysOnTop) => {
        if (!alwaysOnTop && !quitting) restoreWindowOrder();
      });
      window.webContents.on("render-process-gone", (_event, details) => {
        if (
          !quitting &&
          !intentionallyClosingOverlayContents.has(webContentsId) &&
          details.reason !== "clean-exit"
        ) {
          callbacks.onOverlayInvalidated?.();
        }
      });
      window.webContents.once("destroyed", () => {
        intentionallyClosingOverlayContents.delete(webContentsId);
        callbacks.onOverlayGone?.(webContentsId);
      });
      window.webContents.on("did-finish-load", () => {
        if (window.isDestroyed()) return;
        try {
          window.setContentBounds(bounds);
          window.showInactive();
          restoreWindowOrder();
        } catch {
          callbacks.onOverlayInvalidated?.();
        }
      });
    }

    overlayDisplays = nextDisplays;
    overlayWindows = nextWindows;
    await Promise.all(
      nextWindows.map((window) => loadRenderer(window, rendererUrl, "/overlay")),
    );
  } catch (error) {
    destroyOverlayWindows(nextWindows);

    const survivingPrevious = previousEntries.filter(
      ({ window }) => !window.isDestroyed(),
    );
    const survivingWindows = new Set(
      survivingPrevious.map(({ window }) => window),
    );
    destroyOverlayWindows(
      previousWindows.filter((window) => !survivingWindows.has(window)),
    );
    overlayWindows = survivingPrevious.map(({ window }) => window);
    overlayDisplays = survivingPrevious.map(({ display }) => display);
    overlayWindows.forEach(applyOverlayInput);
    restoreWindowOrder();
    throw error;
  }

  destroyOverlayWindows(previousWindows);
  restoreWindowOrder();
}
