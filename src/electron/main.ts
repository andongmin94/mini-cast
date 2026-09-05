import { AnnotationIoGate } from "./annotation-io-gate.js";
import { registerAnnotationFiles } from "./annotation-files.js";
import { registerAnnotationExports } from "./annotation-export.js";
import { randomUUID } from "node:crypto";
import { AnnotationTextEditSessions, type AnnotationTextEditResult } from "../annotation/text-edit.js";
import { applyAnnotationSelectionEdit } from "../annotation/selection.js";
import { readAnnotationTextDraft, type AnnotationTextDraft } from "../annotation/text.js";
import {
  createAnnotationUpdate,
  type AnnotationMutationResult,
} from "../annotation/document-sync.js";
import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AnnotationError,
  type AnnotationFailureReason,
} from "../annotation/errors.js";
import { openSettingsStore } from "./settings-store.js";
import { SettingsWriter } from "./settings-writer.js";
import { runCleanupSteps } from "./shutdown.js";

import {
  GestureLeaseRegistry,
  isGestureId,
} from "../annotation/gesture-leases.js";
import {
  AnnotationHistory,
  isAnnotationElement,
  readAnnotationElementIds,
  type AnnotationDocumentSnapshot,
} from "../annotation/history.js";
import {
  ACTIVE_COMMAND_SHORTCUTS,
  ESCAPE_SHORTCUT,
  TOOL_SHORTCUTS,
} from "./annotation-shortcuts.js";
import {
  resolveClearDisplayId,
  type AnnotationCommandOrigin,
} from "./annotation-target.js";
import {
  DEFAULT_OVERLAY_SETTINGS,
  isAnnotationCommand,
  isAnnotationTool,
  isTransientAnnotationTool,
  type AnnotationCommand,
  type AnnotationState,
  type AnnotationTool,
  type OverlaySettings,
  type SettingsSaveStatus,
} from "../shared/contract.js";
import {
  getConnectedDisplays,
  getOrderedOverlayDisplays,
  type OverlayDisplayMeta,
} from "./display.js";
import {
  configureToolShortcutFallbacks,
  refreshCursorCapture,
  setAnnotationInputMode,
  setKeyboardInputSuppressed,
  startInputCapture,
  stopInputCapture,
} from "./input.js";
import { sendToWebContents, sendToWindow } from "./ipc.js";
import { CoalescingSerialExecutor } from "./serial-executor.js";
import { readSmokeOptions, writeSmokeSentinel } from "./testing/smoke.js";
import { normalizeOverlaySettings, overlaySettingsEqual } from "../shared/settings.js";
import { closeSplash, createSplash } from "./splash.js";
import { createSmokeChecks } from "./testing/interaction-smoke.js";
import { createTray, destroyTray, isTrayReady } from "./tray.js";
import {
  createOverlayWindows,
  createWindow,
  ensureMainWindowVisible,
  hideMainWindow,
  mainWindow,
  overlayDisplays,
  overlayWindows,
  prepareWindowsForQuit,
  registerOverlayLifecycle,
  setOverlayInteractive,
  showMainWindow,
} from "./window.js";

const smokeOptions = readSmokeOptions(process.argv);
if (smokeOptions.mode) {
  const directory =
    smokeOptions.userDataPath ??
    mkdtempSync(path.join(tmpdir(), "mini-cast-smoke-"));
  if (!path.isAbsolute(directory))
    throw new Error("Smoke userData must be an absolute isolated path");
  app.setPath("userData", directory);
}
const rendererUrl =
  app.isPackaged || smokeOptions.mode ? null : "http://127.0.0.1:3000";

if (smokeOptions.disableHardwareAcceleration) app.disableHardwareAcceleration();

type SettingsStore = ReturnType<typeof openSettingsStore>["store"];

const annotationHistory = new AnnotationHistory();
const annotationIo = new AnnotationIoGate();
const textEdits = new AnnotationTextEditSessions(annotationHistory);
const publishedDocuments = new Map<number, AnnotationDocumentSnapshot>();
const gestureLeases = new GestureLeaseRegistry();
const unavailableShortcuts = new Set<string>();
let annotationTool: AnnotationTool = "pass-through";
let textDraft: AnnotationTextDraft | null = null;
let controllerTextEditing = false;
let lastAnnotationDisplayId: number | null = null;
let controllerSettingsRead = false;
let currentSettings = DEFAULT_OVERLAY_SETTINGS;
let settingsWriter: SettingsWriter | null = null;
let settingsRecovered = false;
let settingsPath = "";
let displayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let displayRefreshExecutor: CoalescingSerialExecutor | null = null;
let displayRebuildInProgress = false;
let shuttingDown = false;

function connectedDisplayIds(
  displays: readonly OverlayDisplayMeta[] = overlayDisplays,
) {
  return displays.map((display) => display.id);
}

function getSettingsSaveStatus(): SettingsSaveStatus {
  return {
    state: settingsWriter?.state ?? "saved",
    recovered: settingsRecovered,
  };
}

function sendSettingsSaveStatus() {
  sendToWindow(mainWindow, "settings-save-status", getSettingsSaveStatus());
}

function persistSettingsNow() {
  return settingsWriter?.flush() ?? true;
}

function scheduleSettingsPersist() {
  settingsWriter?.schedule(currentSettings);
}

function readInitialSettings(
  store: SettingsStore,
  displays: readonly OverlayDisplayMeta[],
) {
  const saved = store.get("settings");
  const normalized = normalizeOverlaySettings(
    saved,
    connectedDisplayIds(displays),
  );
  if (!overlaySettingsEqual(saved, normalized))
    settingsWriter?.schedule(normalized);
  return normalized;
}

function sendSettingsToOverlays() {
  overlayWindows.forEach((window) => {
    sendToWindow(window, "settings-updated", currentSettings);
  });
}

function sendSettingsToAll() {
  sendToWindow(mainWindow, "settings-updated", currentSettings);
  sendSettingsToOverlays();
}

function getAnnotationState(): AnnotationState {
  return {
    tool: annotationTool,
    textDraft,
    unavailableShortcuts: [...unavailableShortcuts].sort(),
    canUndo: gestureLeases.size > 0 || (!isTransientAnnotationTool(annotationTool) && annotationHistory.canUndo),
    canRedo: !isTransientAnnotationTool(annotationTool) && annotationHistory.canRedo,
  };
}

function sendAnnotationState() {
  const state = getAnnotationState();
  sendToWindow(mainWindow, "annotation-state-updated", state);
  overlayWindows.forEach((window) => {
    sendToWindow(window, "annotation-state-updated", state);
  });
}

function displayIdForSender(sender: WebContents) {
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      window.webContents.id === sender.id,
  );
  return index >= 0 ? (overlayDisplays[index]?.id ?? null) : null;
}

function sendAnnotationDocument(
  displayId: number,
  snapshot: AnnotationDocumentSnapshot = annotationHistory.getSnapshot(
    displayId,
  ),
  excludedWebContentsId: number | null = null,
) {
  const update = createAnnotationUpdate(
    publishedDocuments.get(displayId),
    snapshot,
  );
  publishedDocuments.set(displayId, snapshot);
  overlayWindows.forEach((window, index) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    if (
      overlayDisplays[index]?.id === displayId &&
      window.webContents.id !== excludedWebContentsId
    )
      sendToWindow(window, "annotation-document-updated", update);
  });
  return update;
}

function annotationMutationResult(
  displayId: number | null,
  reason: AnnotationFailureReason,
): AnnotationMutationResult {
  return {
    accepted: false,
    reason,
    update:
      displayId === null
        ? null
        : {
          kind: "revision",
          displayId,
          revision: annotationHistory.getSnapshot(displayId).revision,
        },
  };
}

function isTopLevelSender(event: IpcMainEvent | IpcMainInvokeEvent) {
  return (
    !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame
  );
}

function isControllerEvent(event: IpcMainEvent | IpcMainInvokeEvent) {
  return isTopLevelSender(event) && isMainWindow(event.sender);
}

function isMainWindow(sender: WebContents) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    mainWindow.webContents.id === sender.id,
  );
}

function registerShortcut(accelerator: string, callback: () => void) {
  globalShortcut.unregister(accelerator);
  const registered = globalShortcut.register(accelerator, callback);
  if (registered) unavailableShortcuts.delete(accelerator);
  else {
    unavailableShortcuts.add(accelerator);
    console.warn(`Global shortcut registration failed: ${accelerator}`);
  }
  return registered;
}

function cancelActiveAnnotationGestures() {
  const canceled = gestureLeases.cancelAll();
  canceled.forEach(({ ownerId, gestureId }) => {
    const target = overlayWindows.find(
      (window) =>
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        window.webContents.id === ownerId,
    );
    sendToWindow(target, "annotation-gesture-cancel", gestureId);
  });
  if (canceled.length) sendAnnotationState();
  return canceled.length > 0;
}

function refreshTransientAnnotationShortcuts() {
  const transient = [
    ESCAPE_SHORTCUT,
    ...ACTIVE_COMMAND_SHORTCUTS.map((shortcut) => shortcut.accelerator),
  ];
  transient.forEach((accelerator) => {
    globalShortcut.unregister(accelerator);
    unavailableShortcuts.delete(accelerator);
  });
  if (annotationTool === "pass-through" || controllerTextEditing) return;

  registerShortcut(ESCAPE_SHORTCUT, () => setAnnotationTool("pass-through"));
  ACTIVE_COMMAND_SHORTCUTS.forEach(({ accelerator, command }) => {
    registerShortcut(accelerator, () => sendAnnotationCommand(command));
  });
}

function registerAnnotationHotkeys() {
  const fallbackCombinations: string[] = [];
  TOOL_SHORTCUTS.forEach(({ accelerator, inputCombination, tool }) => {
    if (!registerShortcut(accelerator, () => setAnnotationTool(tool))) {
      fallbackCombinations.push(inputCombination);
    }
  });
  configureToolShortcutFallbacks(fallbackCombinations, (combination) => {
    const shortcut = TOOL_SHORTCUTS.find(
      (candidate) => candidate.inputCombination === combination,
    );
    if (shortcut) setAnnotationTool(shortcut.tool);
  });
  refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function setControllerTextEditing(editing: boolean) {
  if (controllerTextEditing === editing) return;
  controllerTextEditing = editing;
  setKeyboardInputSuppressed(editing);
  refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function sendTextEditSession() {
  sendToWindow(mainWindow, "annotation-text-edit-session", textEdits.current);
}

function cancelTextEdit() {
  if (!textEdits.cancel()) return;
  sendTextEditSession();
  setControllerTextEditing(false);
}

function setAnnotationTool(tool: AnnotationTool) {
  if (annotationIo.busy && tool !== "pass-through") { sendAnnotationState(); return; }
  cancelTextEdit();
  if (tool !== "text") setControllerTextEditing(false);
  if (tool !== annotationTool) cancelActiveAnnotationGestures();
  annotationTool = tool;
  const interactive = tool !== "pass-through";
  setOverlayInteractive(interactive);
  setAnnotationInputMode(interactive);
  refreshTransientAnnotationShortcuts();
  sendAnnotationState();
}

function annotationCommandDisplayId() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
}

function sendAnnotationCommand(
  command: AnnotationCommand,
  origin: AnnotationCommandOrigin = "shortcut",
) {
  if (displayRebuildInProgress) return;

  if (isTransientAnnotationTool(annotationTool)) {
    // Temporary tools cannot accidentally consume the permanent Undo/Redo history.
    if (command === "redo") return;
    cancelActiveAnnotationGestures();
    if (command === "clear") overlayWindows.forEach(window =>
      sendToWindow(window, "annotation-transient-clear"));
    sendAnnotationState();
    return;
  }

  if (command === "undo" || command === "redo") {
    if (cancelActiveAnnotationGestures()) return;

    const displayId =
      command === "undo" ? annotationHistory.undo() : annotationHistory.redo();
    if (displayId !== null) sendAnnotationDocument(displayId);
    sendAnnotationState();
    return;
  }

  cancelActiveAnnotationGestures();
  const targetDisplayId = resolveClearDisplayId(
    origin,
    annotationCommandDisplayId(),
    lastAnnotationDisplayId,
    connectedDisplayIds(),
  );
  if (targetDisplayId === null) return;

  const displayId = annotationHistory.clearDisplay(targetDisplayId);
  if (displayId !== null) sendAnnotationDocument(displayId);
  sendAnnotationState();
}

function initializeOverlay(event: IpcMainEvent) {
  if (!isTopLevelSender(event)) return;
  const index = overlayWindows.findIndex(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      window.webContents.id === event.sender.id,
  );
  const display = overlayDisplays[index];
  if (!display) return;
  const snapshot = annotationHistory.getSnapshot(display.id);
  publishedDocuments.set(display.id, snapshot);

  sendToWebContents(event.sender, "overlay-init", {
    displayId: display.id,
    width: display.bounds.width,
    height: display.bounds.height,
  });
  sendToWebContents(event.sender, "settings-updated", currentSettings);
  sendToWebContents(
    event.sender,
    "annotation-state-updated",
    getAnnotationState(),
  );
  sendToWebContents(event.sender, "annotation-document-updated", {
    kind: "snapshot",
    document: snapshot,
  });
}

function registerIpc() {
  registerAnnotationFiles({
    history: annotationHistory, gate: annotationIo,
    unavailable: () => shuttingDown || displayRebuildInProgress || controllerTextEditing || Boolean(textEdits.current),
    prepareDialog: () => setAnnotationTool("pass-through"),
    documentChanged: displayId => {
      lastAnnotationDisplayId = displayId;
      sendAnnotationDocument(displayId);
      sendAnnotationState();
    },
  });
  registerAnnotationExports({
    gate: annotationIo,
    history: annotationHistory,
    unavailable: () => shuttingDown || displayRebuildInProgress || controllerTextEditing || Boolean(textEdits.current),
    prepareFileDialog: () => setAnnotationTool("pass-through"),
  });
  ipcMain.on("minimize-window", (event) => {
    if (!isControllerEvent(event)) return;
    setAnnotationTool("pass-through");
    mainWindow?.minimize();
  });

  ipcMain.on("hide-window", (event) => {
    if (isControllerEvent(event)) {
      cancelTextEdit();
      hideMainWindow();
    }
  });

  ipcMain.on("request-displays", (event) => {
    if (isControllerEvent(event)) {
      sendToWebContents(
        event.sender,
        "displays-updated",
        getConnectedDisplays(),
      );
    }
  });

  ipcMain.on("save-settings", (event, settings: unknown) => {
    if (!isControllerEvent(event) || !controllerSettingsRead) return;

    currentSettings = normalizeOverlaySettings(settings, connectedDisplayIds());
    sendSettingsToOverlays();
    scheduleSettingsPersist();
  });

  ipcMain.on("set-annotation-tool", (event, tool: unknown) => {
    if (isControllerEvent(event) && isAnnotationTool(tool)) {
      setAnnotationTool(tool);
    }
  });

  ipcMain.handle("set-annotation-text-draft", (event, value: unknown) => {
    if (!isControllerEvent(event) || annotationTool !== "text") return false;
    const draft = readAnnotationTextDraft(value);
    if (!draft) return false;
    textDraft = draft;
    setControllerTextEditing(false);
    setAnnotationTool("text");
    return true;
  });
  ipcMain.on("annotation-text-editing", (event, value: unknown) => {
    if (!isControllerEvent(event) || typeof value !== "boolean") return;
    if (value && (!mainWindow?.isFocused() || (annotationTool !== "text" && !textEdits.current))) return;
    // Disabling a submit button must not re-enable global Undo while a text save is pending.
    setControllerTextEditing(value || Boolean(textEdits.current && mainWindow?.isFocused()));
  });

  ipcMain.handle("annotation-text-edit-open", (event, revision: unknown, elementId: unknown) => {
    const displayId = isTopLevelSender(event) ? displayIdForSender(event.sender) : null;
    if (displayId === null || displayRebuildInProgress || annotationTool !== "select" || !mainWindow || mainWindow.isDestroyed()) return false;
    try {
      textEdits.open(displayId, revision, elementId, randomUUID());
      cancelActiveAnnotationGestures();
      lastAnnotationDisplayId = displayId;
      showMainWindow();
      setControllerTextEditing(mainWindow.isFocused());
      sendTextEditSession();
      return true;
    } catch (error) {
      if (!(error instanceof AnnotationError)) console.error("Cannot open text editor:", error);
      return false;
    }
  });
  ipcMain.handle("annotation-text-edit-get", event => {
    if (!isControllerEvent(event)) throw new Error("Invalid text edit session request");
    return textEdits.current;
  });
  ipcMain.handle("annotation-text-edit-save", (event, id: unknown, value: unknown): AnnotationTextEditResult => {
    if (!isControllerEvent(event) || displayRebuildInProgress || annotationTool !== "select" ||
        !textEdits.current || !connectedDisplayIds().includes(textEdits.current.displayId))
      return { accepted: false, reason: "unavailable" };
    try {
      const result = textEdits.save(id, value);
      if (result.changed) sendAnnotationDocument(result.displayId);
      sendTextEditSession();
      setControllerTextEditing(false);
      sendAnnotationState();
      return { accepted: true, changed: result.changed };
    } catch (error) {
      if (!(error instanceof AnnotationError)) console.error("Text replacement failed:", error);
      return { accepted: false, reason: error instanceof AnnotationError ? error.reason : "internal" };
    }
  });
  ipcMain.on("annotation-text-edit-cancel", (event, id: unknown) => {
    if (!isControllerEvent(event) || typeof id !== "string") return;
    if (textEdits.cancel(id)) {
      sendTextEditSession();
      setControllerTextEditing(false);
    }
  });

  ipcMain.on("annotation-command", (event, command: unknown) => {
    if (isControllerEvent(event) && isAnnotationCommand(command)) {
      sendAnnotationCommand(command, "controller");
    }
  });

  ipcMain.on("annotation-gesture-begin", (event, gestureId: unknown) => {
    if (!isTopLevelSender(event)) return;
    const displayId = displayIdForSender(event.sender);
    if (
      displayId === null ||
      displayRebuildInProgress ||
      annotationTool === "pass-through" ||
      !isGestureId(gestureId)
    ) {
      return;
    }

    if (!isTransientAnnotationTool(annotationTool)) lastAnnotationDisplayId = displayId;
    const previous = gestureLeases.begin(event.sender.id, gestureId);
    if (previous && previous !== gestureId) {
      sendToWebContents(event.sender, "annotation-gesture-cancel", previous);
    }
    sendAnnotationState();
  });

  ipcMain.handle(
    "annotation-add-element",
    (event, gestureId: unknown, stroke: unknown): AnnotationMutationResult => {
      const displayId = isTopLevelSender(event)
        ? displayIdForSender(event.sender)
        : null;
      if (displayId === null || displayRebuildInProgress || isTransientAnnotationTool(annotationTool))
        return annotationMutationResult(displayId, "unavailable");
      if (
        !isGestureId(gestureId) ||
        !gestureLeases.matches(event.sender.id, gestureId)
      )
        return annotationMutationResult(displayId, "stale-gesture");
      try {
        if (!isAnnotationElement(stroke))
          return annotationMutationResult(displayId, "invalid-element");
        annotationHistory.addElement(displayId, stroke);
        const update = sendAnnotationDocument(
          displayId,
          undefined,
          event.sender.id,
        );
        return { accepted: true, update };
      } catch (error) {
        if (!(error instanceof AnnotationError))
          console.error("Annotation commit failed:", error);
        return annotationMutationResult(
          displayId,
          error instanceof AnnotationError ? error.reason : "internal",
        );
      } finally {
        gestureLeases.end(event.sender.id, gestureId);
        sendAnnotationState();
      }
    },
  );

  ipcMain.handle(
    "annotation-remove-elements",
    (event, gestureId: unknown, value: unknown): AnnotationMutationResult => {
      const displayId = isTopLevelSender(event)
        ? displayIdForSender(event.sender)
        : null;
      if (displayId === null || displayRebuildInProgress || isTransientAnnotationTool(annotationTool))
        return annotationMutationResult(displayId, "unavailable");
      if (
        !isGestureId(gestureId) ||
        !gestureLeases.matches(event.sender.id, gestureId)
      )
        return annotationMutationResult(displayId, "stale-gesture");
      try {
        const ids = readAnnotationElementIds(value);
        if (ids === null)
          return annotationMutationResult(displayId, "invalid-element");
        const changedDisplayId = annotationHistory.removeElements(
          displayId,
          ids,
        );
        if (changedDisplayId === null)
          return annotationMutationResult(displayId, "no-change");
        const update = sendAnnotationDocument(
          displayId,
          undefined,
          event.sender.id,
        );
        return { accepted: true, update };
      } catch (error) {
        console.error("Annotation erase failed:", error);
        return annotationMutationResult(displayId, "internal");
      } finally {
        gestureLeases.end(event.sender.id, gestureId);
        sendAnnotationState();
      }
    },
  );

  ipcMain.handle("annotation-edit-selection", (event, gestureId: unknown, value: unknown): AnnotationMutationResult => {
    const displayId = isTopLevelSender(event) ? displayIdForSender(event.sender) : null;
    if (displayId === null || displayRebuildInProgress) return annotationMutationResult(displayId, "unavailable");
    if (annotationTool !== "select" || !isGestureId(gestureId) || !gestureLeases.matches(event.sender.id, gestureId))
      return annotationMutationResult(displayId, "stale-gesture");
    try {
      const changed = applyAnnotationSelectionEdit(annotationHistory, displayId, value);
      if (changed === null) return annotationMutationResult(displayId, "no-change");
      return { accepted: true, update: sendAnnotationDocument(displayId, undefined, event.sender.id) };
    } catch (error) {
      if (!(error instanceof AnnotationError)) console.error("Selection edit failed:", error);
      return annotationMutationResult(displayId, error instanceof AnnotationError ? error.reason : "internal");
    } finally {
      gestureLeases.end(event.sender.id, gestureId);
      sendAnnotationState();
    }
  });

  ipcMain.handle("get-annotation-document", (event) => {
    const displayId = isTopLevelSender(event)
      ? displayIdForSender(event.sender)
      : null;
    if (displayId === null || displayRebuildInProgress)
      throw new Error(
        "Document is not available during display reconfiguration",
      );
    return annotationHistory.getSnapshot(displayId);
  });

  ipcMain.on("annotation-gesture-end", (event, gestureId: unknown) => {
    if (
      isTopLevelSender(event) &&
      displayIdForSender(event.sender) !== null &&
      isGestureId(gestureId)
    ) {
      gestureLeases.end(event.sender.id, gestureId);
      sendAnnotationState();
    }
  });

  ipcMain.handle("get-settings-save-status", (event) => {
    if (!isControllerEvent(event))
      throw new Error("Invalid settings status request");
    return getSettingsSaveStatus();
  });
  ipcMain.on("retry-settings-save", (event) => {
    if (isControllerEvent(event)) persistSettingsNow();
  });
  ipcMain.on("acknowledge-settings-recovery", (event) => {
    if (!isControllerEvent(event)) return;
    settingsRecovered = false;
    sendSettingsSaveStatus();
  });

  ipcMain.on("overlay-ready", (event) => initializeOverlay(event));

  ipcMain.handle("get-settings", (event) => {
    if (!isControllerEvent(event)) {
      throw new Error("Invalid settings request");
    }
    controllerSettingsRead = true;
    return currentSettings;
  });

  ipcMain.handle("get-annotation-state", (event) => {
    if (!isControllerEvent(event)) {
      throw new Error("Invalid annotation state request");
    }
    return getAnnotationState();
  });
}

function prepareDisplayHistory(displays: readonly OverlayDisplayMeta[]) {
  displays.forEach((display) => {
    annotationHistory.setDisplayViewport(
      display.id,
      display.bounds.width,
      display.bounds.height,
    );
  });
}

function commitDisplaySettings(nextSettings: OverlaySettings) {
  if (overlaySettingsEqual(currentSettings, nextSettings)) return;
  currentSettings = nextSettings;
  scheduleSettingsPersist();
}

function overlayCallbacks() {
  return {
    onOverlayGone(webContentsId: number) {
      if (gestureLeases.removeOwner(webContentsId)) sendAnnotationState();
    },
    onOverlayInvalidated() {
      scheduleDisplayRefresh(0);
    },
  };
}

async function rebuildDisplays() {
  if (shuttingDown) return;

  displayRebuildInProgress = true;
  cancelTextEdit();
  let historyCheckpoint: AnnotationHistory | null = null;
  let overlaySwapCommitted = false;

  try {
    cancelActiveAnnotationGestures();
    const displays = getOrderedOverlayDisplays();
    historyCheckpoint = annotationHistory.clone();
    publishedDocuments.clear();
    prepareDisplayHistory(displays);
    await createOverlayWindows(rendererUrl, displays, overlayCallbacks());
    overlaySwapCommitted = true;
    if (shuttingDown) return;

    const connectedIds = displays.map((display) => display.id);
    annotationHistory.retainDisplays(connectedIds);
    for (const id of publishedDocuments.keys())
      if (!connectedIds.includes(id)) publishedDocuments.delete(id);
    if (
      lastAnnotationDisplayId !== null &&
      !connectedIds.includes(lastAnnotationDisplayId)
    ) {
      lastAnnotationDisplayId = null;
    }
    const nextSettings = normalizeOverlaySettings(
      currentSettings,
      connectedIds,
    );
    commitDisplaySettings(nextSettings);
    ensureMainWindowVisible();
    sendSettingsToAll();
    sendAnnotationState();
    displays.forEach((display) => sendAnnotationDocument(display.id));
    refreshCursorCapture();
    sendToWindow(mainWindow, "displays-updated", getConnectedDisplays());
  } catch (error) {
    if (!overlaySwapCommitted && historyCheckpoint) {
      annotationHistory.restoreFrom(historyCheckpoint);
      publishedDocuments.clear();
      overlayDisplays.forEach((display) => sendAnnotationDocument(display.id));
    }

    try {
      const restoredSettings = normalizeOverlaySettings(
        currentSettings,
        connectedDisplayIds(),
      );
      commitDisplaySettings(restoredSettings);
      sendSettingsToAll();
      sendAnnotationState();
      refreshCursorCapture();
    } catch (recoveryError) {
      console.error("Failed to recover display state:", recoveryError);
    }
    throw error;
  } finally {
    displayRebuildInProgress = false;
  }
}

function stopDisplayRefresh() {
  shuttingDown = true;
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = undefined;
  displayRefreshExecutor = null;
}

function scheduleDisplayRefresh(delayMs = 150) {
  if (shuttingDown || !displayRefreshExecutor) return;
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => {
    displayRefreshTimer = undefined;
    if (shuttingDown) return;
    void displayRefreshExecutor?.request().catch((error) => {
      console.error("Failed to refresh displays:", error);
      setAnnotationTool("pass-through");
    });
  }, delayMs);
}

function registerDisplayEvents() {
  const executor = new CoalescingSerialExecutor(rebuildDisplays);
  displayRefreshExecutor = executor;
  const refresh = () => scheduleDisplayRefresh();
  screen.on("display-added", refresh);
  screen.on("display-removed", refresh);
  screen.on("display-metrics-changed", refresh);
  return executor;
}

async function runSmokeTest() {
  const mode = smokeOptions.mode;
  if (!mode) return;

  if (!isTrayReady()) throw new Error("Production tray was not created");
  if (unavailableShortcuts.size)
    throw new Error(
      `Unavailable production shortcuts: ${[...unavailableShortcuts].join(", ")}`,
    );
  const checks = createSmokeChecks({
    history: annotationHistory,
    state: getAnnotationState,
    refreshDisplays: () => {
      if (!displayRefreshExecutor)
        throw new Error("Display executor is unavailable");
      return displayRefreshExecutor.request();
    },
    publishDocument: sendAnnotationDocument,
    settingsPath,
    settingsState: () => settingsWriter?.state ?? "failed",
  });
  const test =
    mode === "interaction"
      ? checks.performInteractionSmoke()
      : checks.inspectAllRenderers();
  const timeoutMs = mode === "interaction" ? 180_000 : 30_000;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      test,
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("smoke test timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }

  await writeSmokeSentinel(smokeOptions.sentinelPath, {
    mode,
    success: true,
    hardwareAccelerationDisabled: smokeOptions.disableHardwareAcceleration,
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    settingsRecovered,
    expectedQuitCursorSize: 37,
    trayCreated: isTrayReady(),
    diagnostics: checks.diagnostics,
    timestamp: new Date().toISOString(),
  });
  console.log(`MiniCast ${mode} smoke test passed`);
  // Queue a final preference after the sentinel write, then quit normally before
  // the debounce elapses. The parent process checks the persisted value.
  currentSettings = { ...currentSettings, cursorSize: 37 };
  scheduleSettingsPersist();
  app.quit();
}

async function initializeApp() {
  await app.whenReady();

  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const opened = openSettingsStore();
  const store = opened.store;
  settingsRecovered = opened.recovered;
  settingsPath = store.path;
  settingsWriter = new SettingsWriter(
    (settings) => store.set("settings", settings),
    sendSettingsSaveStatus,
  );
  const initialDisplays = getOrderedOverlayDisplays();
  currentSettings = readInitialSettings(store, initialDisplays);
  registerIpc();
  registerOverlayLifecycle();
  createSplash();

  await createWindow(rendererUrl, () => setAnnotationTool("pass-through"));
  mainWindow?.on("blur", () => setControllerTextEditing(false));
  mainWindow?.on("focus", () => {
    if (textEdits.current) setControllerTextEditing(true);
  });
  mainWindow?.webContents.on("did-start-loading", () => {
    cancelTextEdit();
    setControllerTextEditing(false);
    controllerSettingsRead = false;
  });
  mainWindow?.webContents.on("render-process-gone", (_event, details) => {
    if (shuttingDown || details.reason === "clean-exit") return;
    setAnnotationTool("pass-through");
    mainWindow?.webContents.reload();
  });
  const displayExecutor = registerDisplayEvents();
  await displayExecutor.request();
  startInputCapture();

  registerAnnotationHotkeys();
  createTray();
  ensureMainWindowVisible();
  if (app.isPackaged) Menu.setApplicationMenu(null);

  if (smokeOptions.mode) await runSmokeTest();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    runCleanupSteps([
      stopDisplayRefresh,
      prepareWindowsForQuit,
      () => {
        persistSettingsNow();
      },
      () => globalShortcut.unregisterAll(),
      stopInputCapture,
      destroyTray,
    ]);
  });

  void initializeApp().catch(async (error) => {
    closeSplash();

    if (smokeOptions.mode) {
      console.error(
        `MiniCast ${smokeOptions.mode} smoke test failed:`,
        error instanceof Error ? error.stack : String(error),
      );
      await writeSmokeSentinel(smokeOptions.sentinelPath, {
        mode: smokeOptions.mode,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      stopDisplayRefresh();
      prepareWindowsForQuit();
      stopInputCapture();
      app.exit(1);
      return;
    }

    dialog.showErrorBox(
      "MiniCast 실행 오류",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
}
