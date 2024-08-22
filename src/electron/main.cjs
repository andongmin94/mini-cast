const path = require("path");
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut } = require("electron");
const fs = require('fs');

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
    height: 550,
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
  
  displays.forEach((display) => {
    let overlayWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      fullscreen: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlayWindow.loadURL(`http://localhost:${PORT}/overlay`);
    overlayWindows.push(overlayWindow);
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayWindow.webContents.send('update-settings', currentSettings);
    });
    
    // overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    overlayWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'mouseDown') {
        const cursorPosition = screen.getCursorScreenPoint();
        const localPosition = {
          x: cursorPosition.x - display.bounds.x,
          y: cursorPosition.y - display.bounds.y
        };
        overlayWindow.webContents.send('mouse-click', localPosition);
      }
    });
  });
}

function captureMouseEvents() {
  setInterval(() => {
    const cursorPosition = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPosition);

    overlayWindows.forEach((window) => {
      if (isPointInDisplay(cursorPosition, display)) {
        const localPosition = {
          x: cursorPosition.x - display.bounds.x,
          y: cursorPosition.y - display.bounds.y
        };
        window.webContents.send('mouse-move', localPosition);
      }
    });
  }, 16); // 약 60fps
}

let currentSettings = {
  cursorColor: "#000000",
  cursorSize: 24,
  showCursorHighlight: true,
  showClickHighlight: true,
  clickColor: "#000000",
  clickSize: 20,
  clickDuration: 1000,
};

function isPointInDisplay(point, display) {
  return point.x >= display.bounds.x && point.x < display.bounds.x + display.bounds.width &&
         point.y >= display.bounds.y && point.y < display.bounds.y + display.bounds.height;
}

app.whenReady().then(() => {
  createWindow();
  createOverlayWindows();
  captureMouseEvents();

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

ipcMain.on('simulate-click', () => {
  console.log('Simulated click received');
  const cursorPosition = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPosition);

  overlayWindows.forEach((window) => {
    if (isPointInDisplay(cursorPosition, display)) {
      const localPosition = {
        x: cursorPosition.x - display.bounds.x,
        y: cursorPosition.y - display.bounds.y
      };
      console.log('Sending click to overlay:', localPosition);
      window.webContents.send('mouse-click', localPosition);
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});