import { BrowserWindow } from "electron";

let splashWindow: BrowserWindow | null = null;

export function createSplash() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
    },
  });
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<style>
body{margin:0;height:100vh;display:grid;place-content:center;gap:16px;text-align:center;font-family:system-ui,sans-serif;color:#333;user-select:none}
.spinner{width:36px;height:36px;margin:auto;border:4px solid #ddd;border-left-color:#09f;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body><div class="spinner"></div><strong>로딩 중...</strong></body>
</html>`;

  void splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

export function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}
