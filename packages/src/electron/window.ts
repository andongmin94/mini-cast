import path from "path";
import { app, BrowserWindow, screen, shell } from "electron";

import { mouseEventInterval } from "./func.js";
import { __dirname, currentSettings, isDev } from "./main.js"; // isDev를 main.ts에서 가져옴
import { closeSplash } from "./splash.js";

let mainWindow: BrowserWindow | null;
let overlayWindows: BrowserWindow[] = [];
export let adWindow: BrowserWindow;

export async function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 416,
    height: 352,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"), // preload 사용 시 주석 해제
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash(); // 스플래시 닫기
    mainWindow?.show();
  });

  // --- 플랫폼별 우클릭 메뉴 비활성화 시도 ---
  if (process.platform === "win32") {
    mainWindow.hookWindowMessage(278, function () {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setEnabled(false);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setEnabled(true);
          }
        }, 100);
      }
      return true;
    });
  } else {
    mainWindow.webContents.on("context-menu", (event) => {
      console.log("Main process context-menu event triggered on macOS/Linux");
      event.preventDefault();
    });
  }

  // 종료 설정
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin") {
      // macOS: 사용자가 명시적으로 종료(Cmd+Q 등)하지 않으면 숨김
      e.preventDefault();
      mainWindow?.hide();
      app.dock?.hide(); // Dock 에서도 숨김
    }
    // 다른 OS 에서는 window-all-closed 에서 앱 종료 처리
    else {
      clearInterval(mouseEventInterval);
      app.quit();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null; // 창 참조 제거
  });

  // 광고용 윈도우 생성
  const adWindowWidth = mainWindow.getSize()[0];
  const adWindowHeight = 121;
  adWindow = new BrowserWindow({
    width: adWindowWidth,
    height: adWindowHeight,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    parent: mainWindow,
    webPreferences: {
      webSecurity: false,
    },
  });

  adWindow.loadURL("https://andongmin.com/ad/mini-cast");

  const updateAdWindowPosition = () => {
    const mainBounds = mainWindow?.getBounds();
    if (
      mainBounds &&
      typeof mainBounds.x === "number" &&
      typeof mainBounds.y === "number" &&
      typeof mainBounds.width === "number" &&
      typeof mainBounds.height === "number"
    ) {
      adWindow.setBounds({
        x: mainBounds.x,
        y: mainBounds.y + mainBounds.height,
        width: mainBounds.width,
        height: adWindowHeight,
      });
    }
  };

  mainWindow.webContents.on("did-finish-load", () => {
    updateAdWindowPosition();
    adWindow.show();
  });

  mainWindow.on("move", updateAdWindowPosition);
  mainWindow.on("resize", updateAdWindowPosition);
  mainWindow.on("show", () => {
    adWindow.show();
  });

  adWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

export function getMainWindow() {
  return mainWindow;
}

export function createOverlayWindows(PORT: number) {
  overlayWindows.forEach((window) => window.close());
  overlayWindows = [];
  const displays = screen.getAllDisplays();

  displays.forEach((display, index) => {
    const overlayWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"), // preload 사용 시 주석 해제
      },
    });
    overlayWindow.loadURL(`http://localhost:${PORT}/overlay`);
    overlayWindows.push(overlayWindow);
    overlayWindow.webContents.on("did-finish-load", () => {
      overlayWindow.webContents.send("init", { id: index, ...display.bounds });
      overlayWindow.webContents.send("update-settings", currentSettings);
    });

    // 클릭만 전달
    overlayWindow.setIgnoreMouseEvents(true, { forward: false });
  });
}

export function getOverlayWindows() {
  return overlayWindows;
}
