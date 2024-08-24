const path = require("path");
const { app, BrowserWindow, BrowserView, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell } = require("electron");
const fs = require('fs');
const { GlobalKeyboardListener } = require('node-global-key-listener');

const templateDir = __dirname;
const packageJsonPath = path.join(templateDir, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

require("dotenv").config();
let PORT = process.env.NODE_ENV === 'development' ? 3000 : 1994;

const express = require('express');
const server = express();
const isDev = process.env.NODE_ENV === 'development';

if (!isDev) {
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
    width: 600,
    height: 410,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
};

function getConnectedDisplays() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    name: `모니터 ${index + 1}`,
    bounds: display.bounds
  }));
}

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
  let specialKeys = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false
  };
  let capsLockOn = false;
  let lastCombination = '';
  let lastTimestamp = 0;

  const keyNameMap = {
    'LEFT CTRL': 'Ctrl', 'RIGHT CTRL': 'Ctrl',
    'LEFT SHIFT': 'Shift', 'RIGHT SHIFT': 'Shift',
    'LEFT ALT': 'Alt', 'RIGHT ALT': 'Alt',
    'LEFT META': 'Meta', 'RIGHT META': 'Meta',
    'ESCAPE': 'Esc', 'RETURN': 'Enter',
    'BACK SPACE': 'Backspace', 'CAPS LOCK': 'CapsLock',
    'SPACE': 'Space', 'TAB': 'Tab',
    'UP ARROW': '↑', 'DOWN ARROW': '↓', 'LEFT ARROW': '←', 'RIGHT ARROW': '→',
    'PERIOD': '.', 'COMMA': ',', 'SEMICOLON': ';', 'FORWARD SLASH': '/',
    'BACK SLASH': '\\', 'EQUAL': '=', 'MINUS': '-', 'OPEN BRACKET': '[',
    'CLOSE BRACKET': ']', 'QUOTE': "'", 'BACK QUOTE': '`'
  };

  function getKeyName(name) {
    if (name in keyNameMap) {
      return keyNameMap[name];
    }
    if (name.length === 1) {
      return name;
    }
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  function sendKeyPress(combination, keyDetails) {
    const currentTime = Date.now();
    if (combination !== lastCombination || currentTime - lastTimestamp > 200) {
      overlayWindows.forEach((window, index) => {
        window.webContents.send('key-press', { ...keyDetails, displayId: index, combination });
        // console.log('key-press', { ...keyDetails, combination });
      });
      lastCombination = combination;
      lastTimestamp = currentTime;
    }
  }

  gkl.addListener((e) => {
    const isSpecialKey = ['LEFT CTRL', 'RIGHT CTRL', 'LEFT SHIFT', 'RIGHT SHIFT', 'LEFT ALT', 'RIGHT ALT', 'LEFT META', 'RIGHT META', 'CAPS LOCK'].includes(e.name);
    
    if (e.name === 'CAPS LOCK' && e.state === 'DOWN') {
      capsLockOn = !capsLockOn;
    }

    const keyName = getKeyName(e.name);

    if (isSpecialKey && e.name !== 'CAPS LOCK') {
      specialKeys[keyName.toLowerCase()] = e.state === 'DOWN';
    }

    if (e.state === 'DOWN' && !isSpecialKey) {
      const specialKeyCombination = [];
      if (specialKeys.ctrl) specialKeyCombination.push('Ctrl');
      if (specialKeys.shift) specialKeyCombination.push('Shift');
      if (specialKeys.alt) specialKeyCombination.push('Alt');
      if (specialKeys.meta) specialKeyCombination.push('Meta');

      let combination = keyName;
      if (specialKeyCombination.length > 0) {
        combination = `${specialKeyCombination.join(' + ')} + ${keyName}`;
      }

      let displayKey = keyName;
      if (keyName.length === 1 && keyName >= 'A' && keyName <= 'Z') {
        const shouldBeUpperCase = (capsLockOn && !specialKeys.shift) || (!capsLockOn && specialKeys.shift);
        displayKey = shouldBeUpperCase ? keyName : keyName.toLowerCase();
      }

      const keyDetails = {
        key: displayKey,
        code: e.rawKey._nameRaw,
        ctrlKey: specialKeys.ctrl,
        shiftKey: specialKeys.shift,
        altKey: specialKeys.alt,
        metaKey: specialKeys.meta,
        capsLock: capsLockOn,
        timestamp: Date.now()
      };

      sendKeyPress(combination.replace(keyName, displayKey), keyDetails);
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
  keyDisplayBackgroundColor: "rgba(0, 0, 0, 0.2)",
  keyDisplayTextColor: "rgba(255, 255, 255, 1)",
  keyDisplayPosition: "bottom-right",
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

  // Send initial displays data when requested
  ipcMain.on('request-displays', (event) => {
      const displays = getConnectedDisplays();
      mainWindow.webContents.send('displays-updated', displays);
  });
  

  // Display change events
  screen.on('display-added', () => {
    const displays = getConnectedDisplays();
    mainWindow.webContents.send('displays-updated', displays);
    createOverlayWindows();
  });

  screen.on('display-removed', () => {
    const displays = getConnectedDisplays();
    mainWindow.webContents.send('displays-updated', displays);
    createOverlayWindows();
  });

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