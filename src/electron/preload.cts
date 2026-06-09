// Electron의 sandbox preload는 CommonJS여야 하므로 이 파일은 .cts로 둡니다.
const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

type Listener = (...args: unknown[]) => void;

function on(channel: string, listener: Listener) {
  const wrappedListener = (_event: unknown, ...args: unknown[]) => {
    listener(...args);
  };

  ipcRenderer.on(channel, wrappedListener);
  return () => ipcRenderer.removeListener(channel, wrappedListener);
}

contextBridge.exposeInMainWorld("miniCast", {
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
  hideWindow: () => ipcRenderer.send("hide-window"),
  requestDisplays: () => ipcRenderer.send("request-displays"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.send("save-settings", settings),
  notifyOverlayReady: () => ipcRenderer.send("overlay-ready"),

  getSettings: () => ipcRenderer.invoke("get-settings"),
  getRuntimeInfo: () => ipcRenderer.invoke("get-runtime-info"),

  onDisplaysUpdated: (listener: Listener) => on("displays-updated", listener),
  onSettingsUpdated: (listener: Listener) => on("settings-updated", listener),
  onMouseMove: (listener: Listener) => on("mouse-move", listener),
  onMouseButton: (listener: Listener) => on("mouse-button", listener),
  onKeyPress: (listener: Listener) => on("key-press", listener),
  onOverlayInit: (listener: Listener) => on("overlay-init", listener),
});
