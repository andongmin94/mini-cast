const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

type Listener = (...args: unknown[]) => void;

function on(channel: string, listener: Listener) {
  const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("miniCast", {
  getAnnotationBoards: () => ipcRenderer.invoke("get-annotation-boards"),
  setAnnotationBoard: (request: unknown) => ipcRenderer.invoke("set-annotation-board", request),
  onAnnotationBoardsUpdated: (listener: Listener) => on("annotation-boards-updated", listener),
  annotationFile: (request: unknown) => ipcRenderer.invoke("annotation-file", request),
  exportAnnotation: (request: unknown) => ipcRenderer.invoke("annotation-export", request),
  onAnnotationExportRender: (listener: Listener) => on("annotation-export-render", listener),
  completeAnnotationExport: (id: unknown, bytes: unknown) => ipcRenderer.send("annotation-export-rendered", id, bytes),
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
  hideWindow: () => ipcRenderer.send("hide-window"),
  requestDisplays: () => ipcRenderer.send("request-displays"),
  saveSettings: (settings: unknown) =>
    ipcRenderer.send("save-settings", settings),
  notifyOverlayReady: () => ipcRenderer.send("overlay-ready"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  getSettingsSaveStatus: () => ipcRenderer.invoke("get-settings-save-status"),
  retrySettingsSave: () => ipcRenderer.send("retry-settings-save"),
  acknowledgeSettingsRecovery: () =>
    ipcRenderer.send("acknowledge-settings-recovery"),
  getAnnotationDocument: () => ipcRenderer.invoke("get-annotation-document"),
  onSettingsSaveStatus: (listener: Listener) =>
    on("settings-save-status", listener),
  getAnnotationState: () => ipcRenderer.invoke("get-annotation-state"),
  setAnnotationTool: (tool: unknown) =>
    ipcRenderer.send("set-annotation-tool", tool),
  setAnnotationTextDraft: (draft: unknown) => ipcRenderer.invoke("set-annotation-text-draft", draft),
  setAnnotationTextEditing: (editing: unknown) => ipcRenderer.send("annotation-text-editing", editing),
  requestAnnotationTextEdit: (revision: unknown, elementId: unknown) =>
    ipcRenderer.invoke("annotation-text-edit-open", revision, elementId),
  getAnnotationTextEdit: () => ipcRenderer.invoke("annotation-text-edit-get"),
  saveAnnotationTextEdit: (id: unknown, value: unknown) =>
    ipcRenderer.invoke("annotation-text-edit-save", id, value),
  cancelAnnotationTextEdit: (id: unknown) => ipcRenderer.send("annotation-text-edit-cancel", id),
  onAnnotationTextEdit: (listener: Listener) => on("annotation-text-edit-session", listener),
  sendAnnotationCommand: (command: unknown) =>
    ipcRenderer.send("annotation-command", command),
  beginAnnotationGesture: (gestureId: unknown) =>
    ipcRenderer.send("annotation-gesture-begin", gestureId),
  commitAnnotationElement: (gestureId: unknown, stroke: unknown) =>
    ipcRenderer.invoke("annotation-add-element", gestureId, stroke),
  removeAnnotationElements: (gestureId: unknown, ids: unknown) =>
    ipcRenderer.invoke("annotation-remove-elements", gestureId, ids),
  editAnnotationSelection: (gestureId: unknown, edit: unknown) =>
    ipcRenderer.invoke("annotation-edit-selection", gestureId, edit),
  endAnnotationGesture: (gestureId: unknown) =>
    ipcRenderer.send("annotation-gesture-end", gestureId),
  onDisplaysUpdated: (listener: Listener) => on("displays-updated", listener),
  onSettingsUpdated: (listener: Listener) => on("settings-updated", listener),
  onMouseMove: (listener: Listener) => on("mouse-move", listener),
  onMouseButton: (listener: Listener) => on("mouse-button", listener),
  onKeyPress: (listener: Listener) => on("key-press", listener),
  onOverlayInit: (listener: Listener) => on("overlay-init", listener),
  onAnnotationStateUpdated: (listener: Listener) =>
    on("annotation-state-updated", listener),
  onAnnotationDocumentUpdated: (listener: Listener) =>
    on("annotation-document-updated", listener),
  onAnnotationTransientClear: (listener: Listener) => on("annotation-transient-clear", listener),
  onAnnotationGestureCancel: (listener: Listener) =>
    on("annotation-gesture-cancel", listener),
});
