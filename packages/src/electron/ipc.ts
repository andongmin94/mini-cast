import { ipcMain } from 'electron';
import { getConnectedDisplays } from './func.js';

/**
 * 개발 환경용 메뉴 설정
 * @param {Function} getMainWindow - 메인 윈도우 객체를 반환하는 함수
 */
interface MainWindowGetter {
  (): Electron.BrowserWindow | null; // 메인 윈도우 객체를 반환하는 함수
}
export function setupIpcHandlers(getMainWindow: MainWindowGetter, getOverlayWindows: () => Electron.BrowserWindow[], getStore:any, currentSettings: any) {
  ipcMain.on('hidden', () => {
    getMainWindow()?.hide();
  });

  ipcMain.on('minimize', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on('maximize', () => {
    const mw = getMainWindow();
    if (mw) {
      mw.isMaximized() ? mw.restore() : mw.maximize();
    }
  });

  // 여기에 다른 IPC 핸들러 추가 가능
  ipcMain.on('request-displays', (event) => {
      const displays = getConnectedDisplays();
      getMainWindow()?.webContents.send('displays-updated', displays);
  });
  ipcMain.on('update-settings', (event, newSettings) => {
  currentSettings = { ...currentSettings, ...newSettings };
  const store = getStore();
  store.set('settings', currentSettings);
  getOverlayWindows().forEach(window => {
    window.webContents.send('update-settings', currentSettings);
  });
});

  ipcMain.handle('get-value', (event, key) => {
  const store = getStore();
  const value = store.get(key);
  return value;
});
}