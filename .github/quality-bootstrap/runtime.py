from pathlib import Path
import json
import re


def edit(path, before, after, count=1):
    p = Path(path)
    source = p.read_text(encoding='utf-8')
    actual = source.count(before)
    if actual != count:
        raise RuntimeError(f'{path}: expected {count} copies of {before[:90]!r}, found {actual}')
    p.write_text(source.replace(before, after), encoding='utf-8')


def replace_block(path, start, end, replacement):
    p = Path(path)
    source = p.read_text(encoding='utf-8')
    left = source.index(start)
    right = source.index(end, left)
    p.write_text(source[:left] + replacement + source[right:], encoding='utf-8')


# Keep the installed product version distinguishable from the previous QA candidate.
for filename in ['package.json', 'package-lock.json']:
    p = Path(filename)
    value = json.loads(p.read_text(encoding='utf-8'))
    assert value['version'] == '0.3.2'
    value['version'] = '0.3.3'
    if filename == 'package-lock.json':
        value['packages']['']['version'] = '0.3.3'
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

history = 'src/annotation/history.ts'
p = Path(history)
p.write_text('import { AnnotationError, type AnnotationFailureReason } from "./errors.js";\n\n' + p.read_text(encoding='utf-8'), encoding='utf-8')
edit(history, '''export interface AnnotationMutationResult {
  accepted: boolean;
  document: AnnotationDocumentSnapshot | null;
}''', '''export type AnnotationMutationResult =
  | { accepted: true; document: AnnotationDocumentSnapshot }
  | {
      accepted: false;
      reason: AnnotationFailureReason;
      document: AnnotationDocumentSnapshot | null;
    };''')
edit(history, 'throw new Error("Invalid annotation stroke");', 'throw new AnnotationError("invalid-stroke");')
edit(history, 'throw new Error(`Duplicate annotation stroke id: ${stroke.id}`);', 'throw new AnnotationError("duplicate-stroke");')
edit(history, 'throw new Error(`Duplicate annotation stroke id: ${entry.stroke.id}`);', 'throw new AnnotationError("duplicate-stroke");')
edit(history, 'throw new Error("Annotation stroke limit reached");', 'throw new AnnotationError("stroke-limit");', 3)
edit(history, 'throw new Error("Annotation point limit reached");', 'throw new AnnotationError("point-limit");', 3)
edit(history, '''    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.revert(entry);
    this.redoStack.push(entry);''', '''    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return null;

    this.revert(entry);
    this.undoStack.pop();
    this.redoStack.push(entry);''')
edit(history, '''    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.apply(entry);
    this.undoStack.push(entry);''', '''    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return null;

    this.apply(entry);
    this.redoStack.pop();
    this.undoStack.push(entry);''')

contract = 'src/electron/contract.ts'
edit(contract, '  unavailableShortcuts: readonly string[];\n}', '''  unavailableShortcuts: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface SettingsSaveStatus {
  state: "saved" | "pending" | "failed";
  recovered: boolean;
}''')

main = 'src/electron/main.ts'
edit(main, '  screen,\n', '  screen,\n  session,\n')
edit(main, '  type IpcMainEvent,\n', '  type IpcMainEvent,\n  type IpcMainInvokeEvent,\n')
edit(main, 'import Store from "electron-store";', '''import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AnnotationError, type AnnotationFailureReason } from "../annotation/errors.js";
import { openSettingsStore } from "./settings-store.js";
import { SettingsWriter } from "./settings-writer.js";
import { runCleanupSteps } from "./shutdown.js";''')
edit(main, '  type OverlaySettings,\n', '  type OverlaySettings,\n  type SettingsSaveStatus,\n')
edit(main, 'type SettingsStore = Store<{ settings: OverlaySettings }>;\n', 'type SettingsStore = ReturnType<typeof openSettingsStore>["store"];\n')
edit(main, '''let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettingsStore: SettingsStore | null = null;''', '''let settingsWriter: SettingsWriter | null = null;
let settingsRecovered = false;
let settingsPath = "";''')
replace_block(main, 'function persistSettingsNow()', 'function readInitialSettings(', '''function getSettingsSaveStatus(): SettingsSaveStatus {
  return { state: settingsWriter?.state ?? "saved", recovered: settingsRecovered };
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

''')
edit(main, 'if (!overlaySettingsEqual(saved, normalized)) store.set("settings", normalized);', 'if (!overlaySettingsEqual(saved, normalized)) settingsWriter?.schedule(normalized);')
edit(main, '    unavailableShortcuts: [...unavailableShortcuts].sort(),', '''    unavailableShortcuts: [...unavailableShortcuts].sort(),
    canUndo: annotationHistory.canUndo || gestureLeases.hasActive,
    canRedo: annotationHistory.canRedo,''')
edit('src/annotation/gesture-leases.ts', 'export class GestureLeaseRegistry {', '''export class GestureLeaseRegistry {
  get hasActive() {
    return this.leases.size > 0;
  }
''')
# The lease field name is asserted below; no alternative names are supported.
assert re.search(r'private leases\s*=', Path('src/annotation/gesture-leases.ts').read_text(encoding='utf-8'))

replace_block(main, 'function annotationMutationResult(', 'function isMainWindow(', '''function annotationMutationResult(
  displayId: number | null,
  reason: AnnotationFailureReason,
): AnnotationMutationResult {
  return {
    accepted: false,
    reason,
    document: displayId === null ? null : annotationHistory.getSnapshot(displayId),
  };
}

function isTopLevelSender(event: IpcMainEvent | IpcMainInvokeEvent) {
  return !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame;
}

function isControllerEvent(event: IpcMainEvent | IpcMainInvokeEvent) {
  return isTopLevelSender(event) && isMainWindow(event.sender);
}

''')
# All controller IPC calls now verify the sender frame as well as its WebContents.
p = Path(main)
source = p.read_text(encoding='utf-8')
start = source.index('function registerIpc(')
end = source.index('function prepareDisplayHistory(', start)
segment = source[start:end].replace('isMainWindow(event.sender)', 'isControllerEvent(event)')
source = source[:start] + segment + source[end:]
p.write_text(source, encoding='utf-8')
edit(main, 'function registerIpc(store: SettingsStore)', 'function registerIpc()')
edit(main, 'scheduleSettingsPersist(store);', 'scheduleSettingsPersist();', 2)
edit(main, 'function initializeOverlay(event: IpcMainEvent) {', 'function initializeOverlay(event: IpcMainEvent) {\n  if (!isTopLevelSender(event)) return;')
edit(main, '''  ipcMain.on("annotation-gesture-begin", (event, gestureId: unknown) => {
    const displayId = displayIdForSender(event.sender);''', '''  ipcMain.on("annotation-gesture-begin", (event, gestureId: unknown) => {
    if (!isTopLevelSender(event)) return;
    const displayId = displayIdForSender(event.sender);''')
edit(main, '''      sendToWebContents(event.sender, "annotation-gesture-cancel", previous);
    }
  });''', '''      sendToWebContents(event.sender, "annotation-gesture-cancel", previous);
    }
    sendAnnotationState();
  });''')
replace_block(main, '  ipcMain.handle(\n    "annotation-add-stroke",', '  ipcMain.on("overlay-ready",', '''  ipcMain.handle("annotation-add-stroke", (event, gestureId: unknown, stroke: unknown): AnnotationMutationResult => {
    const displayId = isTopLevelSender(event) ? displayIdForSender(event.sender) : null;
    if (displayId === null || displayRebuildInProgress) return annotationMutationResult(displayId, "unavailable");
    if (!isGestureId(gestureId) || !gestureLeases.matches(event.sender.id, gestureId)) return annotationMutationResult(displayId, "stale-gesture");
    try {
      if (!isAnnotationStroke(stroke)) return annotationMutationResult(displayId, "invalid-stroke");
      annotationHistory.addStroke(displayId, stroke);
      const document = annotationHistory.getSnapshot(displayId);
      sendAnnotationDocument(displayId, document, event.sender.id);
      return { accepted: true, document };
    } catch (error) {
      if (!(error instanceof AnnotationError)) console.error("Annotation commit failed:", error);
      return annotationMutationResult(displayId, error instanceof AnnotationError ? error.reason : "internal");
    } finally {
      gestureLeases.end(event.sender.id, gestureId);
      sendAnnotationState();
    }
  });

  ipcMain.handle("annotation-remove-strokes", (event, gestureId: unknown, value: unknown): AnnotationMutationResult => {
    const displayId = isTopLevelSender(event) ? displayIdForSender(event.sender) : null;
    if (displayId === null || displayRebuildInProgress) return annotationMutationResult(displayId, "unavailable");
    if (!isGestureId(gestureId) || !gestureLeases.matches(event.sender.id, gestureId)) return annotationMutationResult(displayId, "stale-gesture");
    try {
      const ids = readAnnotationStrokeIds(value);
      if (ids === null) return annotationMutationResult(displayId, "invalid-stroke");
      const changedDisplayId = annotationHistory.removeStrokes(displayId, ids);
      if (changedDisplayId === null) return annotationMutationResult(displayId, "no-change");
      const document = annotationHistory.getSnapshot(displayId);
      sendAnnotationDocument(displayId, document, event.sender.id);
      return { accepted: true, document };
    } catch (error) {
      console.error("Annotation erase failed:", error);
      return annotationMutationResult(displayId, "internal");
    } finally {
      gestureLeases.end(event.sender.id, gestureId);
      sendAnnotationState();
    }
  });

  ipcMain.handle("get-annotation-document", (event) => {
    const displayId = isTopLevelSender(event) ? displayIdForSender(event.sender) : null;
    if (displayId === null) throw new Error("Invalid document request");
    return annotationHistory.getSnapshot(displayId);
  });

  ipcMain.on("annotation-gesture-end", (event, gestureId: unknown) => {
    if (isTopLevelSender(event) && displayIdForSender(event.sender) !== null && isGestureId(gestureId)) {
      gestureLeases.end(event.sender.id, gestureId);
      sendAnnotationState();
    }
  });

  ipcMain.handle("get-settings-save-status", (event) => {
    if (!isControllerEvent(event)) throw new Error("Invalid settings status request");
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

''')
edit(main, '  return canceled.length > 0;', '  if (canceled.length) sendAnnotationState();\n  return canceled.length > 0;')
edit(main, '''    if (displayId !== null) sendAnnotationDocument(displayId);
    return;''', '''    if (displayId !== null) sendAnnotationDocument(displayId);
    sendAnnotationState();
    return;''')
edit(main, '''  if (displayId !== null) sendAnnotationDocument(displayId);
}''', '''  if (displayId !== null) sendAnnotationDocument(displayId);
  sendAnnotationState();
}''')
edit(main, '''function commitDisplaySettings(
  store: SettingsStore,
  nextSettings: OverlaySettings,
)''', 'function commitDisplaySettings(nextSettings: OverlaySettings)')
edit(main, 'commitDisplaySettings(store, nextSettings);', 'commitDisplaySettings(nextSettings);')
edit(main, 'commitDisplaySettings(store, restoredSettings);', 'commitDisplaySettings(restoredSettings);')
edit(main, 'async function rebuildDisplays(store: SettingsStore)', 'async function rebuildDisplays()')
edit(main, 'function registerDisplayEvents(store: SettingsStore)', 'function registerDisplayEvents()')
edit(main, 'new CoalescingSerialExecutor(() => rebuildDisplays(store))', 'new CoalescingSerialExecutor(rebuildDisplays)')
edit(main, '''  const store = new Store<{ settings: OverlaySettings }>({
    defaults: { settings: DEFAULT_OVERLAY_SETTINGS },
  });''', '''  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const opened = openSettingsStore();
  const store = opened.store;
  settingsRecovered = opened.recovered;
  settingsPath = store.path;
  settingsWriter = new SettingsWriter((settings) => store.set("settings", settings), sendSettingsSaveStatus);''')
edit(main, '  registerIpc(store);', '  registerIpc();')
edit(main, '  const displayExecutor = registerDisplayEvents(store);', '  const displayExecutor = registerDisplayEvents();')
edit(main, '''    stopDisplayRefresh();
    prepareWindowsForQuit();
    persistSettingsNow();
    globalShortcut.unregisterAll();
    stopInputCapture();
    destroyTray();''', '''    runCleanupSteps([
      stopDisplayRefresh,
      prepareWindowsForQuit,
      () => { persistSettingsNow(); },
      () => globalShortcut.unregisterAll(),
      stopInputCapture,
      destroyTray,
    ]);''')

# Controlled APIs only; no raw ipcRenderer or generic invoke capability is exposed.
bridge = 'src/electron/preload.cts'
edit(bridge, '  getSettings: () => ipcRenderer.invoke("get-settings"),', '''  getSettings: () => ipcRenderer.invoke("get-settings"),
  getSettingsSaveStatus: () => ipcRenderer.invoke("get-settings-save-status"),
  retrySettingsSave: () => ipcRenderer.send("retry-settings-save"),
  acknowledgeSettingsRecovery: () => ipcRenderer.send("acknowledge-settings-recovery"),
  getAnnotationDocument: () => ipcRenderer.invoke("get-annotation-document"),
  onSettingsSaveStatus: (listener: Listener) => on("settings-save-status", listener),''')
dts = 'src/electron-api.d.ts'
edit(dts, '  OverlaySettings,\n', '  OverlaySettings,\n  SettingsSaveStatus,\n')
edit(dts, '  getSettings(): Promise<OverlaySettings>;', '''  getSettings(): Promise<OverlaySettings>;
  getSettingsSaveStatus(): Promise<SettingsSaveStatus>;
  retrySettingsSave(): void;
  acknowledgeSettingsRecovery(): void;
  getAnnotationDocument(): Promise<AnnotationDocumentSnapshot>;
  onSettingsSaveStatus(listener: (status: SettingsSaveStatus) => void): Unsubscribe;''')

surface = 'src/components/AnnotationSurface.tsx'
edit(surface, '  useRef,\n', '  useRef,\n  useState,\n')
edit(surface, 'import { shouldAdoptAnnotationDocument }', 'import { annotationFailureMessage } from "@/annotation/errors";\nimport { shouldAdoptAnnotationDocument }')
edit(surface, '  const committedCanvasRef =', '  const [notice, setNotice] = useState<string | null>(null);\n  const committedCanvasRef =')
edit(surface, '      activePointerRef.current = null;', '''      if (gestureCanvas) delete gestureCanvas.dataset.activeGesture;
      activePointerRef.current = null;''')
edit(surface, '''    event.preventDefault();
    const gestureId''', '''    event.preventDefault();
    setNotice(null);
    event.currentTarget.dataset.activeGesture = "true";
    const gestureId''')
edit(surface, '''      drawActiveSegments(gestureCanvasRef.current, active, previousLength);
    }
  }''', '''      drawActiveSegments(gestureCanvasRef.current, active, previousLength);
    }
    if (active.points.length >= MAX_ANNOTATION_POINTS_PER_STROKE) {
      commitGesture();
      setNotice("한 획의 길이 한도에 도달하여 여기까지 저장을 요청했습니다. 펜을 떼고 새 획을 시작해 주세요.");
    }
  }''')
edit(surface, '''          if (result.document) {
            adoptAuthoritativeDocument(result.document, true);
          }
''', '''          if (result.document) {
            adoptAuthoritativeDocument(result.document, true);
          }
          if (!result.accepted) setNotice(annotationFailureMessage(result.reason));
''', 2)
edit(surface, '''        .catch(() => {
          pendingStrokesRef.current.delete(committed.id);
          renderCommitted();
        })''', '''        .catch(() => {
          pendingStrokesRef.current.delete(committed.id);
          setNotice("판서 통신이 끊겼습니다. 저장 상태를 다시 확인합니다.");
          renderCommitted();
          void miniCast.getAnnotationDocument().then((next) => {
            if (adoptAuthoritativeDocument(next, true)) renderCommitted();
          }).catch(() => setNotice("판서 상태를 확인할 수 없습니다. 앱 연결을 확인해 주세요."));
        })''')
edit(surface, '''        .catch(() => {
          erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
          renderCommitted();
        })''', '''        .catch(() => {
          erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
          setNotice("지우기 통신이 끊겼습니다. 저장 상태를 다시 확인합니다.");
          renderCommitted();
          void miniCast.getAnnotationDocument().then((next) => {
            if (adoptAuthoritativeDocument(next, true)) renderCommitted();
          }).catch(() => setNotice("판서 상태를 확인할 수 없습니다. 앱 연결을 확인해 주세요."));
        })''')
edit(surface, '''        onLostPointerCapture={handlePointerCancel}
        aria-hidden="true"
      />''', '''        onLostPointerCapture={handlePointerCancel}
        aria-hidden="true"
      />
      {notice && (
        <div role="alert" data-annotation-notice="" className="pointer-events-none fixed bottom-4 left-1/2 max-w-lg -translate-x-1/2 rounded-md bg-slate-900 px-4 py-3 text-sm text-white" style={{ zIndex: 5 }}>
          {notice}
        </div>
      )}''')

controller = 'src/components/Controller.tsx'
edit(controller, '  OverlaySettings,\n', '  OverlaySettings,\n  SettingsSaveStatus,\n')
edit(controller, '    unavailableShortcuts: [],', '    unavailableShortcuts: [],\n    canUndo: false,\n    canRedo: false,')
edit(controller, '  const [displays, setDisplays]', '  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>({ state: "saved", recovered: false });\n  const [displays, setDisplays]')
edit(controller, '    const stopAnnotation = miniCast.onAnnotationStateUpdated(setAnnotationState);', '''    void miniCast.getSettingsSaveStatus().then((status) => {
      if (active) setSaveStatus(status);
    }).catch((error) => console.error("Failed to load settings status:", error));
    const stopSaveStatus = miniCast.onSettingsSaveStatus(setSaveStatus);
    const stopAnnotation = miniCast.onAnnotationStateUpdated(setAnnotationState);''')
edit(controller, '      stopAnnotation();', '      stopAnnotation();\n      stopSaveStatus();')
edit(controller, 'h-[336px] overflow-hidden p-4', 'h-[336px] overflow-y-auto p-4')
edit(controller, '        <Tabs defaultValue="cursor"', '''        {(saveStatus.state === "failed" || saveStatus.recovered) && (
          <div role="alert" data-settings-status={saveStatus.state} className="mb-3 rounded-md border border-amber-500 bg-amber-50 p-3 text-xs text-slate-900">
            {saveStatus.state === "failed" ? (
              <>
                <p>설정을 저장하지 못했습니다. 현재 변경은 앱에서만 적용되며, 종료하면 사라질 수 있습니다.</p>
                <button type="button" data-settings-retry="" className="mt-2 font-semibold underline" onClick={() => miniCast.retrySettingsSave()}>저장 다시 시도</button>
              </>
            ) : (
              <>
                <p>설정 파일을 읽을 수 없어 기본 설정으로 초기화했습니다.</p>
                <button type="button" className="mt-2 font-semibold underline" onClick={() => miniCast.acknowledgeSettingsRecovery()}>확인</button>
              </>
            )}
          </div>
        )}
        <Tabs defaultValue="cursor"''')
edit(controller, '              unavailableShortcuts={annotationState.unavailableShortcuts}', '''              unavailableShortcuts={annotationState.unavailableShortcuts}
              canUndo={annotationState.canUndo}
              canRedo={annotationState.canRedo}''')
controls = 'src/components/AnnotationControls.tsx'
edit(controls, '  unavailableShortcuts: readonly string[];', '  unavailableShortcuts: readonly string[];\n  canUndo: boolean;\n  canRedo: boolean;')
edit(controls, '  unavailableShortcuts,\n', '  unavailableShortcuts,\n  canUndo,\n  canRedo,\n')
edit(controls, '            data-annotation-tool={option}', '            data-annotation-tool={option}\n            aria-pressed={tool === option}')
edit(controls, '          onClick={() => onCommand("undo")}', '          data-annotation-command="undo"\n          disabled={!canUndo}\n          onClick={() => onCommand("undo")}')
edit(controls, '          onClick={() => onCommand("redo")}', '          data-annotation-command="redo"\n          disabled={!canRedo}\n          onClick={() => onCommand("redo")}')
edit(controls, '          onClick={() => onCommand("clear")}', '          data-annotation-command="clear"\n          onClick={() => onCommand("clear")}')
edit(controls, 'className="bg-muted hover:bg-accent flex h-8', 'className="bg-muted hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 flex h-8', 2)

overlay = 'src/components/Overlay.tsx'
edit(overlay, '    unavailableShortcuts: [],', '    unavailableShortcuts: [],\n    canUndo: false,\n    canRedo: false,')
edit(overlay, '      miniCast.onSettingsUpdated(setSettings),', '''      miniCast.onSettingsUpdated((next) => {
        if (!next.showKeyDisplay || settingsRef.current.keyDisplayId !== next.keyDisplayId) {
          clearKeyPressTimers();
          setKeyPresses([]);
        }
        settingsRef.current = next;
        setSettings(next);
      }),''')

# Make the non-focussed real-time overlay policy explicit; keep safe Electron defaults.
window = 'src/electron/window.ts'
edit(window, '      webviewTag: false,', '      webviewTag: false,\n      devTools: !app.isPackaged,')
edit(window, '          webviewTag: false,', '          webviewTag: false,\n          devTools: !app.isPackaged,\n          backgroundThrottling: false,')
