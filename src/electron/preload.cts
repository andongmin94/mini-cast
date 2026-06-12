const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

type Listener = (...args: unknown[]) => void;

function on(channel: string, listener: Listener) {
  const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("miniCast", {
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
  hideWindow: () => ipcRenderer.send("hide-window"),
  requestDisplays: () => ipcRenderer.send("request-displays"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.send("save-settings", settings),
  notifyOverlayReady: () => ipcRenderer.send("overlay-ready"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  onDisplaysUpdated: (listener: Listener) => on("displays-updated", listener),
  onSettingsUpdated: (listener: Listener) => on("settings-updated", listener),
  onMouseMove: (listener: Listener) => on("mouse-move", listener),
  onMouseButton: (listener: Listener) => on("mouse-button", listener),
  onKeyPress: (listener: Listener) => on("key-press", listener),
  onOverlayInit: (listener: Listener) => on("overlay-init", listener),
});
