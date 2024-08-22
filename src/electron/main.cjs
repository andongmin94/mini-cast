const path = require("path");
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut } = require("electron");
const fs = require('fs');
const { GlobalKeyboardListener } = require('node-global-key-listener');

const templateDir = __dirname;
const packageJsonPath = path.join(templateDir, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

require("dotenv").config();
let PORT = process.env.NODE_ENV === 'development' ? 3000 : 1994;

const express = require('express');
const server = express();

if (process.env.NODE_ENV !== 'development') {
  server.use(express.static(path.join(__dirname, '../../dist')));
  server.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
  });
  server.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
  });
  server.listen(PORT, () => {}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      PORT += 1;
      setTimeout(() => {
        server.listen(PORT);
      }, 1000);
    }
  });
}

let mainWindow;
let overlayWindows = [];

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 350,
    height: 750,
    frame: false,
    resizable: false,
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
};

function createOverlayWindows() {
  overlayWindows.forEach(window => window.close());
  overlayWindows = [];
  const displays = screen.getAllDisplays();
  
  displays.forEach((display, index) => {
    let overlayWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      fullscreen: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlayWindow.loadURL(`http://localhost:${PORT}/overlay`);
    overlayWindows.push(overlayWindow);
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayWindow.webContents.send('init', { id: index, ...display.bounds });
      overlayWindow.webContents.send('update-settings', currentSettings);
    });
    
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  });
}

function captureMouseEvents() {
  setInterval(() => {
    const cursorPosition = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPosition);

    overlayWindows.forEach((window, index) => {
      const display = screen.getAllDisplays()[index];
      if (display.id === activeDisplay.id) {
        const localPosition = {
          x: cursorPosition.x - display.bounds.x,
          y: cursorPosition.y - display.bounds.y
        };
        window.webContents.send('mouse-move', localPosition);
      } else {
        window.webContents.send('mouse-move', null);
      }
    });
  }, 16); // 약 60fps
}

function captureKeyboardEvents() {
  const gkl = new GlobalKeyboardListener();

  gkl.addListener((e) => {
    if (e.state === 'DOWN') {
      const keyDetails = {
        key: e.name,
        code: e.rawKey._nameRaw,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        timestamp: Date.now()
      };

      overlayWindows.forEach((window, index) => {
        window.webContents.send('key-press', { ...keyDetails, displayId: index });
        console.log('key-press', keyDetails);
      });
    }
  });
}

let currentSettings = {
  cursorFillColor: "rgba(255, 255, 0, 0.5)",
  cursorStrokeColor: "rgba(255, 0, 0, 0.5)",
  cursorSize: 30,
  showCursorHighlight: true,
  keyDisplayMonitor: 0,
  keyDisplayDuration: 2000,
  keyDisplayFontSize: 16,
  keyDisplayBackgroundColor: "rgba(0, 0, 0, 0.7)",
  keyDisplayTextColor: "rgba(255, 255, 255, 1)",
};

app.whenReady().then(() => {
  createWindow();
  createOverlayWindows();
  captureMouseEvents();
  captureKeyboardEvents();

  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")));
  tray.setToolTip(pkg.build.productName);
  tray.on("double-click", () => mainWindow.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", type: "normal", click: () => mainWindow.show() },
      { label: "Quit", type: "normal", click: () => app.quit() },
    ])
  );

  if (process.env.NODE_ENV === "development") {
    const menu = Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "Reload",
            accelerator: "F5",
            click: () => {
              mainWindow.reload();
            },
          },
          {
            label: "Toggle DevTools",
            accelerator: "F12",
            click: () => {
              mainWindow.webContents.toggleDevTools();
              overlayWindows[0].webContents.toggleDevTools();
            },
          },
        ],
      },
    ]);
    Menu.setApplicationMenu(menu);
  }

  screen.on('display-added', createOverlayWindows);
  screen.on('display-removed', createOverlayWindows);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on("hidden", () => mainWindow.hide());
ipcMain.on("minimize", () => mainWindow.minimize());

ipcMain.on('update-settings', (event, newSettings) => {
  currentSettings = { ...currentSettings, ...newSettings };
  overlayWindows.forEach(window => {
    window.webContents.send('update-settings', currentSettings);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});