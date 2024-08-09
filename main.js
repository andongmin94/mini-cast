const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays[0]; // 네 번째 모니터 선택 (인덱스는 0부터 시작)

  if (!targetDisplay) {
    console.error('네 번째 모니터를 찾을 수 없습니다.');
    return;
  }

  mainWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setPosition(targetDisplay.bounds.x, targetDisplay.bounds.y);

  // 개발 중 디버깅을 위해 개발자 도구를 엽니다.
  // mainWindow.webContents.openDevTools();

  // 마우스 이벤트를 무시하도록 설정
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});