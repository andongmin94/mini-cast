const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    // 허용된 채널 목록
    let validChannels = ["minimize", "hidden", "update-settings", "request-displays"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    let validChannels = ["displays-updated", "update-settings", "mouse-move", "key-press", "init"];
    if (validChannels.includes(channel)) {
      // Strip event as it includes `sender` and is a security risk
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  removeListener: (channel, func) => {
    let validChannels = ["displays-updated", "update-settings", "mouse-move", "key-press", "init"];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, func);
    }
  },
  removeAllListeners: (channel) => {
    let validChannels = ["displays-updated", "update-settings", "mouse-move", "key-press", "init"];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  get: () => ipcRenderer.invoke('get-settings'),
});