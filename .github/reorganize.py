"""Apply the reviewed text-editing increment in the opt-in Windows job.
A guard makes the next npm check fail even if the historical shell masks Python's exit code.
No source download, credential extraction, branch, or automatic workflow is used.
"""
from pathlib import Path
import json
import subprocess

package_path = Path('package.json')
original_package = json.loads(package_path.read_text(encoding='utf-8'))
guarded = json.loads(json.dumps(original_package))
guarded['scripts']['precheck'] = 'node -e "throw new Error(\'Text editing preparation incomplete; refusing old-source verification\')"'
package_path.write_text(json.dumps(guarded, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

PREPARATION = r"""
from pathlib import Path
import json
import subprocess

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')

def change(path, old, new, count=1):
    source = read(path)
    if source.count(old) != count:
        raise RuntimeError(f'{path}: expected {count} exact targets, found {source.count(old)}: {old[:100]}')
    write(path, source.replace(old, new))

if original_package['version'] != '0.7.0':
    raise RuntimeError('Expected the reviewed 0.7.0 baseline')
expected = {
    'src/annotation/history.ts': '0e32047a6e4b5e28d06f6309366ae44c3aba34d7',
    'src/electron/main.ts': '447c2b0c850b0a6fbcab126659cd7d87efdae07e',
    'src/renderer/components/AnnotationTextComposer.tsx': 'd0974418a5ed5ef802a8686c066b1d7a9ddbcaa1',
}
for path, sha in expected.items():
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD:' + path], text=True).strip()
    if actual != sha:
        raise RuntimeError(f'Unreviewed concurrent change: {path}')

change('src/annotation/text.ts', 'export interface TextInkBox {', '''export interface AnnotationTextReplacement extends AnnotationTextDraft {
  readonly box: TextInkBox;
}

export interface TextInkBox {''')

change('src/annotation/history.ts', '/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */', '''/** Re-measure content without resetting the existing affine frame, style or ID. */
export function replaceAnnotationText(element: TextElement, value: unknown): TextElement {
  if (!isAnnotationElement(element) || element.tool !== "text" || !isRecord(value))
    throw new AnnotationError("invalid-element");
  const draft = readAnnotationTextDraft(value);
  if (!draft || draft.text !== value.text || !isRecord(value.box))
    throw new AnnotationError("invalid-element");
  const candidate: TextElement = {
    ...element, text: draft.text, fontSize: draft.fontSize,
    box: value.box as unknown as TextInkBox,
  };
  if (!isAnnotationElement(candidate)) throw new AnnotationError("invalid-element");
  // A font remeasurement alone must not create an edit or clear Redo.
  if (element.text === candidate.text && element.fontSize === candidate.fontSize) return element;
  return immutableElement(candidate) as TextElement;
}

/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */''')

change('src/annotation/history.ts', '  /** Build and validate every destination before replacing any source geometry. */', '''  editText(displayId: number, id: string, value: unknown) {
    if (typeof id !== "string" || !id.length || id.length > 128) throw new AnnotationError("invalid-element");
    const source = this.document(displayId).elements.find(element => element.id === id);
    if (!source) throw new AnnotationError("stale-document");
    if (source.tool !== "text") throw new AnnotationError("invalid-element");
    const replacement = replaceAnnotationText(source, value);
    return this.transformElements(displayId, [id], replacement === source, () => replacement);
  }

  /** Build and validate every destination before replacing any source geometry. */''')
change('src/annotation/history.ts', '''    const elements = document.elements.slice();
    for (const change of entry.changes) elements[change.index] = undo ? change.before : change.after;
    document.elements = elements;
    this.touch(entry.displayId);''', '''    // Text replacement can change storage cost, unlike a pure coordinate transform.
    const pointCount = entry.changes.reduce((total, change) => total
      - annotationElementCost(document.elements[change.index])
      + annotationElementCost(undo ? change.before : change.after), document.pointCount);
    if (!Number.isSafeInteger(pointCount) || pointCount < 0) throw new AnnotationError("invalid-element");
    if (pointCount > MAX_ANNOTATION_POINTS_PER_DISPLAY) throw new AnnotationError("point-limit");
    const elements = document.elements.slice();
    for (const change of entry.changes) elements[change.index] = undo ? change.before : change.after;
    document.elements = elements;
    document.pointCount = pointCount;
    this.touch(entry.displayId);''')

write('src/annotation/text-edit.ts', '''import { AnnotationError, type AnnotationFailureReason } from "./errors.js";
import type { AnnotationHistory, TextElement } from "./history.js";

export interface AnnotationTextEditSession {
  readonly id: string;
  readonly displayId: number;
  readonly revision: number;
  readonly element: TextElement;
}

export type AnnotationTextEditResult =
  | { readonly accepted: true; readonly changed: boolean }
  | { readonly accepted: false; readonly reason: AnnotationFailureReason };

/** One explicit, non-persisted editor session. A save can affect only its original text. */
export class AnnotationTextEditSessions {
  private session: AnnotationTextEditSession | null = null;

  constructor(private readonly history: AnnotationHistory) {}

  get current() { return this.session; }

  open(displayId: number, revision: unknown, elementId: unknown, id: string) {
    if (this.session) throw new AnnotationError("unavailable");
    if (!Number.isSafeInteger(displayId) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
        typeof elementId !== "string" || !elementId.length || elementId.length > 128 || !id || id.length > 128)
      throw new AnnotationError("invalid-element");
    const document = this.history.getSnapshot(displayId);
    if (revision !== document.revision) throw new AnnotationError("stale-document");
    const element = document.elements.find(item => item.id === elementId);
    if (!element) throw new AnnotationError("stale-document");
    if (element.tool !== "text") throw new AnnotationError("invalid-element");
    this.session = Object.freeze({ id, displayId, revision, element });
    return this.session;
  }

  save(id: unknown, value: unknown) {
    const session = this.session;
    if (!session || id !== session.id) throw new AnnotationError("stale-gesture");
    if (this.history.getSnapshot(session.displayId).revision !== session.revision)
      throw new AnnotationError("stale-document");
    const changed = this.history.editText(session.displayId, session.element.id, value) !== null;
    this.session = null;
    return { displayId: session.displayId, changed };
  }

  cancel(id?: unknown) {
    if (!this.session || (id !== undefined && id !== this.session.id)) return false;
    this.session = null;
    return true;
  }
}
''')

change('src/electron/main.ts', 'import { applyAnnotationSelectionEdit }', '''import { randomUUID } from "node:crypto";
import { AnnotationTextEditSessions, type AnnotationTextEditResult } from "../annotation/text-edit.js";
import { applyAnnotationSelectionEdit }''')
change('src/electron/main.ts', 'const annotationHistory = new AnnotationHistory();', '''const annotationHistory = new AnnotationHistory();
const textEdits = new AnnotationTextEditSessions(annotationHistory);''')
change('src/electron/main.ts', 'function setAnnotationTool(tool: AnnotationTool) {', '''function sendTextEditSession() {
  sendToWindow(mainWindow, "annotation-text-edit-session", textEdits.current);
}

function cancelTextEdit() {
  if (!textEdits.cancel()) return;
  sendTextEditSession();
  setControllerTextEditing(false);
}

function setAnnotationTool(tool: AnnotationTool) {
  cancelTextEdit();''')
change('src/electron/main.ts', '    if (isControllerEvent(event)) hideMainWindow();', '''    if (isControllerEvent(event)) {
      cancelTextEdit();
      hideMainWindow();
    }''')
change('src/electron/main.ts', '''    if (value && (!mainWindow?.isFocused() || annotationTool !== "text")) return;
    setControllerTextEditing(value);''', '''    if (value && (!mainWindow?.isFocused() || (annotationTool !== "text" && !textEdits.current))) return;
    // Disabling a submit button must not re-enable global Undo while a text save is pending.
    setControllerTextEditing(value || Boolean(textEdits.current && mainWindow?.isFocused()));''')
change('src/electron/main.ts', '  ipcMain.on("annotation-command", (event, command: unknown) => {', '''  ipcMain.handle("annotation-text-edit-open", (event, revision: unknown, elementId: unknown) => {
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

  ipcMain.on("annotation-command", (event, command: unknown) => {''')
change('src/electron/main.ts', '''  displayRebuildInProgress = true;
  let historyCheckpoint''', '''  displayRebuildInProgress = true;
  cancelTextEdit();
  let historyCheckpoint''')
change('src/electron/main.ts', '''  mainWindow?.on("blur", () => setControllerTextEditing(false));''', '''  mainWindow?.on("blur", () => setControllerTextEditing(false));
  mainWindow?.on("focus", () => {
    if (textEdits.current) setControllerTextEditing(true);
  });''')
change('src/electron/main.ts', '''  mainWindow?.webContents.on("did-start-loading", () => {
    setControllerTextEditing(false);''', '''  mainWindow?.webContents.on("did-start-loading", () => {
    cancelTextEdit();
    setControllerTextEditing(false);''')

change('src/shared/electron-api.d.ts', 'import type { AnnotationSelectionEdit }', '''import type { AnnotationTextEditSession, AnnotationTextEditResult } from "../annotation/text-edit";
import type { AnnotationTextReplacement } from "../annotation/text";
import type { AnnotationSelectionEdit }''')
change('src/shared/electron-api.d.ts', '  setAnnotationTextEditing(editing: boolean): void;', '''  setAnnotationTextEditing(editing: boolean): void;
  requestAnnotationTextEdit(revision: number, elementId: string): Promise<boolean>;
  getAnnotationTextEdit(): Promise<AnnotationTextEditSession | null>;
  saveAnnotationTextEdit(id: string, value: AnnotationTextReplacement): Promise<AnnotationTextEditResult>;
  cancelAnnotationTextEdit(id: string): void;
  onAnnotationTextEdit(listener: (session: AnnotationTextEditSession | null) => void): Unsubscribe;''')
change('src/electron/preload.cts', '  sendAnnotationCommand: (command: unknown) =>', '''  requestAnnotationTextEdit: (revision: unknown, elementId: unknown) =>
    ipcRenderer.invoke("annotation-text-edit-open", revision, elementId),
  getAnnotationTextEdit: () => ipcRenderer.invoke("annotation-text-edit-get"),
  saveAnnotationTextEdit: (id: unknown, value: unknown) =>
    ipcRenderer.invoke("annotation-text-edit-save", id, value),
  cancelAnnotationTextEdit: (id: unknown) => ipcRenderer.send("annotation-text-edit-cancel", id),
  onAnnotationTextEdit: (listener: Listener) => on("annotation-text-edit-session", listener),
  sendAnnotationCommand: (command: unknown) =>''')

write('src/renderer/components/AnnotationExistingTextEditor.tsx', '''import { useEffect, useRef, useState } from "react";
import type { AnnotationTextEditSession } from "@/annotation/text-edit";
import { annotationFailureMessage } from "@/annotation/errors";
import { annotationTextFont, createTextElement, type AnnotationTextDraft } from "@/annotation/text";
import AnnotationTextComposer from "./AnnotationTextComposer";

/** Reuse the focusable controller composer; no input window is placed on the desktop. */
export default function AnnotationExistingTextEditor() {
  const [session, setSession] = useState<AnnotationTextEditSession | null>(null);
  const current = useRef<AnnotationTextEditSession | null>(null);
  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    let alive = true;
    let pushed = false;
    const adopt = (next: AnnotationTextEditSession | null) => {
      if (!alive) return;
      current.current = next;
      setSession(next);
    };
    const stop = miniCast.onAnnotationTextEdit(next => { pushed = true; adopt(next); });
    void miniCast.getAnnotationTextEdit().then(next => {
      if (!pushed) adopt(next);
    }).catch(error => console.error("Cannot read text edit session:", error));
    return () => { alive = false; current.current = null; stop(); };
  }, []);

  if (!session) return null;
  const editing = session;
  async function save(draft: AnnotationTextDraft): Promise<boolean | string> {
    try {
      const faces = await document.fonts.load(annotationTextFont(draft.fontSize), "한글 ABC");
      if (!faces.length) return "판서 글꼴을 불러오지 못했습니다. 기존 텍스트는 바꾸지 않았습니다.";
      if (current.current?.id !== editing.id) return "취소되었거나 다른 편집으로 바뀐 요청입니다.";
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return "글자 크기를 측정하지 못했습니다. 기존 텍스트는 유지됩니다.";
      const measured = createTextElement(context, editing.element.id, draft, { x: 0, y: 0 }, editing.element.color);
      const result = await miniCast.saveAnnotationTextEdit(editing.id, {
        text: measured.text, fontSize: measured.fontSize, box: measured.box,
      });
      if (!result.accepted) return annotationFailureMessage(result.reason) ?? "텍스트 변경을 적용하지 못했습니다.";
      if (current.current?.id === editing.id) { current.current = null; setSession(null); }
      return true;
    } catch {
      // Do not blindly retry a save whose acknowledgement may have been lost.
      try {
        const next = await miniCast.getAnnotationTextEdit();
        if (current.current?.id === editing.id) { current.current = next; setSession(next); }
      } catch { /* Keep the user's draft until they explicitly cancel or retry. */ }
      return "변경 결과를 확인하지 못했습니다. 기존 내용을 확인한 뒤 다시 시도해 주세요.";
    }
  }
  return <section data-annotation-existing-text-editor="" className="mb-3">
    <AnnotationTextComposer key={editing.id} draft={editing.element} onPrepare={save}
      onCancel={() => miniCast.cancelAnnotationTextEdit(editing.id)} />
  </section>;
}
''')
change('src/renderer/components/Controller.tsx', 'import type { AnnotationTextDraft }', '''import AnnotationExistingTextEditor from "./AnnotationExistingTextEditor";
import type { AnnotationTextDraft }''')
change('src/renderer/components/Controller.tsx', '''      <div className="pointer-events-auto z-[999] h-[336px] overflow-y-auto p-4">''', '''      <div className="pointer-events-auto z-[999] h-[336px] overflow-y-auto p-4">
        <AnnotationExistingTextEditor />''')

change('src/renderer/components/AnnotationTextComposer.tsx', '''  onPrepare(draft: AnnotationTextDraft): Promise<boolean>;''', '''  onPrepare(draft: AnnotationTextDraft): Promise<boolean | string>;
  onCancel?(): void;''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''export default function AnnotationTextComposer({ draft, onPrepare }: Props) {''', '''export default function AnnotationTextComposer({ draft, onPrepare, onCancel }: Props) {
  const editing = Boolean(onCancel);''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''  async function prepare() {''', '''  useEffect(() => {
    if (editing) root.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);

  async function prepare() {''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''      setMessage(accepted ? "화면의 원하는 위치를 클릭해 배치하세요." : "텍스트를 준비하지 못했습니다. 앱 연결을 확인해 주세요.");
      if (accepted) {''', '''      setMessage(typeof accepted === "string" ? accepted : accepted
        ? (editing ? "텍스트를 수정했습니다." : "화면의 원하는 위치를 클릭해 배치하세요.")
        : "텍스트를 준비하지 못했습니다. 앱 연결을 확인해 주세요.");
      if (accepted === true) {''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''          miniCast.setAnnotationTool("pass-through");''', '''          if (!busy) {
            if (onCancel) onCancel();
            else miniCast.setAnnotationTool("pass-through");
          }''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''className="block text-xs font-medium">배치할 텍스트</label>''', '''className="block text-xs font-medium">{editing ? "선택한 텍스트 수정" : "배치할 텍스트"}</label>''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''        disabled={busy}
        maxLength''', '''        readOnly={busy}
        autoFocus={editing}
        maxLength''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''줄 · Enter 줄바꿈 · Ctrl+Enter 배치 준비''', '''줄 · Enter 줄바꿈 · Ctrl+Enter {editing ? "수정 적용" : "배치 준비"}''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''        {busy ? "준비 중…" : "화면에 배치"}''', '''        {busy ? "처리 중…" : editing ? "수정 적용" : "화면에 배치"}''')
change('src/renderer/components/AnnotationTextComposer.tsx', '''      {message && <p role="status"''', '''      {onCancel && <button type="button" data-annotation-text-cancel="" disabled={busy}
        className="w-full rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={onCancel}>수정 취소</button>}
      {message && <p role="status"''')

selection = 'src/renderer/components/AnnotationSelectionSurface.tsx'
change(selection, '  const [count, setCount] = useState(0);', '''  const [count, setCount] = useState(0);
  const [canEditText, setCanEditText] = useState(false);
  const openingEditor = useRef(false);''')
change(selection, '    if (alive.current) setCount(ids.length);', '''    if (alive.current) {
      setCount(ids.length);
      setCanEditText(ids.length === 1 && current.current?.elements.find(element => element.id === ids[0])?.tool === "text");
    }''')
change(selection, '  function deleteSelected() {', '''  async function editSelectedText() {
    const source = current.current;
    const ids = selected.current;
    if (!source || ids.length !== 1 || pending.current || drag.current || openingEditor.current) return;
    if (source.elements.find(element => element.id === ids[0])?.tool !== "text") return;
    const generation = epoch.current;
    openingEditor.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await miniCast.requestAnnotationTextEdit(source.revision, ids[0]);
      if (!accepted && alive.current && epoch.current === generation)
        setNotice("텍스트 편집을 열지 못했습니다. 진행 중인 편집을 마치고 다시 선택해 주세요.");
    } catch {
      if (alive.current && epoch.current === generation) setNotice("텍스트 편집 연결을 확인해 주세요.");
    } finally {
      openingEditor.current = false;
      if (alive.current && epoch.current === generation) setBusy(false);
    }
  }

  function deleteSelected() {''')
change(selection, '''        <button type="button" data-selection-delete=""''', '''        <button type="button" data-selection-text-edit="" disabled={busy || !canEditText}
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40" onClick={() => void editSelectedText()}>텍스트 수정</button>
        <button type="button" data-selection-delete=""''')

write('tests/unit/annotation/text-edit.test.mjs', r'''import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, replaceAnnotationText, annotationElementCost, MAX_ANNOTATION_POINTS_PER_DISPLAY } from "../../../dist/annotation/history.js";
import { AnnotationTextEditSessions } from "../../../dist/annotation/text-edit.js";
import { textControlPoints } from "../../../dist/annotation/primitive-frame.js";
import { AnnotationReplica, createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const box = { minX: -1, minY: 0, maxX: 120, maxY: 40 };
const text = (id = "text", value = "기존 제목") => ({ id, tool: "text", text: value, fontSize: 28,
  color: "#123456", opacity: 1, points: textControlPoints({ x: 100, y: 100 }), box: { ...box } });
const revision = (value = "수정한 제목\n둘째 줄", fontSize = 30) => ({ text: value, fontSize,
  box: { minX: -2, minY: 0, maxX: 190, maxY: 90 } });
function setup() {
  const history = new AnnotationHistory(); history.setDisplayViewport(1, 800, 600);
  history.addElement(1, text());
  history.addElement(1, { id: "ink", tool: "pen", width: 4, color: "#FF0000", opacity: 1, points: [{ x: 20, y: 20 }] });
  return history;
}
function rejected(history, fn, reason) {
  const before = history.getSnapshot(1), undo = history.canUndo, redo = history.canRedo;
  assert.throws(fn, error => error.reason === reason);
  assert.strictEqual(history.getSnapshot(1), before);
  assert.equal(history.canUndo, undo); assert.equal(history.canRedo, redo);
}

test("text replacement preserves ID, style, order and the full rotated/sheared frame", () => {
  const history = setup();
  history.rotateElements(1, ["text"], { x: 100, y: 100 }, Math.PI / 6);
  history.resizeElements(1, ["text"], { x: 100, y: 100 }, 1.6, 0.7);
  const before = history.getSnapshot(1);
  history.editText(1, "text", revision());
  const after = history.getSnapshot(1);
  assert.deepEqual(after.elements[0].points, before.elements[0].points);
  assert.equal(after.elements[0].text, revision().text);
  assert.equal(after.elements[0].fontSize, 30);
  assert.equal(after.elements[0].color, before.elements[0].color);
  assert.equal(after.elements[0].id, "text");
  assert.strictEqual(after.elements[1], before.elements[1]);
  assert.equal(after.revision, before.revision + 1);
  history.undo(); assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
});

test("identical content and size preserve snapshot identity, history and Redo", () => {
  const history = setup(); history.undo(); const before = history.getSnapshot(1);
  const element = before.elements[0];
  assert.equal(history.editText(1, "text", { text: element.text, fontSize: element.fontSize, box }), null);
  assert.strictEqual(history.getSnapshot(1), before); assert.equal(history.canRedo, true);
});

test("text edits reject empty content, malformed metrics and non-text targets before mutation", () => {
  const history = setup();
  for (const value of [null, {}, revision(" "), revision("x", 97), revision("x\u0000"),
    revision("x".repeat(2001)), revision(Array(21).fill("x").join("\n")),
    { ...revision(), box: { ...box, maxX: Infinity } }, { ...revision(), box: { ...box, maxX: -2 } }])
    rejected(history, () => history.editText(1, "text", value), "invalid-element");
  rejected(history, () => history.editText(1, "ink", revision()), "invalid-element");
  rejected(history, () => history.editText(1, "missing", revision()), "stale-document");
});

test("new text metrics cannot overflow the existing affine frame", () => {
  const history = setup();
  history.resizeElements(1, ["text"], { x: 100, y: 100 }, 1000, 1000);
  rejected(history, () => history.editText(1, "text", { ...revision(), box: { ...box, maxX: 2000 } }), "invalid-element");
});

test("untrusted replacement metadata cannot move, recolor or re-identify existing text", () => {
  const source = text(); const input = { ...revision(), id: "attacker", color: "#000000", points: [{ x: 9, y: 9 }] };
  const next = replaceAnnotationText(source, input);
  assert.deepEqual(next.points, source.points); assert.equal(next.id, source.id); assert.equal(next.color, source.color);
  input.box.maxX = 1234; source.points[0].x = 999;
  assert.equal(next.box.maxX, 190); assert.equal(next.points[0].x, 100);
  assert.ok(Object.isFrozen(next)); assert.ok(Object.isFrozen(next.box)); assert.ok(Object.isFrozen(next.points[0]));
});

test("replacement cost is checked atomically and restored by Undo/Redo", () => {
  const history = new AnnotationHistory(); history.addElement(1, text("text", "ABCDE"));
  let remaining = MAX_ANNOTATION_POINTS_PER_DISPLAY - annotationElementCost(history.getSnapshot(1).elements[0]);
  let index = 0;
  while (remaining) {
    const length = Math.min(50000, remaining);
    history.addElement(1, { id: "bulk" + index++, tool: "pen", width: 1, color: "#000000", opacity: 1,
      points: Array.from({ length }, () => ({ x: 1, y: 1 })) });
    remaining -= length;
  }
  rejected(history, () => history.editText(1, "text", revision("ABCDEF")), "point-limit");
  history.editText(1, "text", revision("ABCD"));
  history.addElement(1, { id: "extra", tool: "pen", width: 1, color: "#000000", opacity: 1, points: [{ x: 2, y: 2 }] });
  history.undo(); history.undo();
  assert.equal(history.getSnapshot(1).elements[0].text, "ABCDE");
  rejected(history, () => history.editText(1, "text", revision("ABCDEF")), "point-limit");
  history.redo(); history.redo();
  assert.equal(history.getSnapshot(1).elements.at(-1).id, "extra");
});

test("editing participates in global chronological history and viewport rebasing", () => {
  const history = setup(); history.addElement(2, text("other"));
  const before = history.getSnapshot(1);
  history.editText(1, "text", revision()); const checkpoint = history.clone();
  history.setDisplayViewport(1, 1600, 300); const rebased = history.getSnapshot(1);
  assert.equal(history.undo(), 1);
  assert.equal(history.getSnapshot(1).elements[0].text, before.elements[0].text);
  history.redo(); assert.deepEqual(history.getSnapshot(1).elements, rebased.elements);
  history.restoreFrom(checkpoint); history.undo();
  assert.deepEqual(history.getSnapshot(1).elements, before.elements);
  assert.equal(history.undo(), 2);
});

test("replacement deltas carry only the changed text and survive reversed acknowledgements", async () => {
  const history = setup(); const before = history.getSnapshot(1);
  const replica = new AnnotationReplica(async () => history.getSnapshot(1), () => {});
  replica.reset(1); await replica.receive({ kind: "snapshot", document: before });
  history.editText(1, "text", revision()); const edited = history.getSnapshot(1);
  const delta = createAnnotationUpdate(before, edited);
  assert.equal(delta.kind, "delta"); assert.deepEqual(delta.removedIds, ["text"]); assert.equal(delta.inserted.length, 1);
  assert.deepEqual(reduceAnnotationUpdate(before, 1, delta).document, edited);
  history.undo(); const undone = history.getSnapshot(1);
  await replica.receive(createAnnotationUpdate(edited, undone)); await replica.receive(delta);
  assert.deepEqual(replica.document, undone);
});

test("500 text replacements leave all retained snapshots and exact Undo values unchanged", () => {
  const history = setup(); const original = history.getSnapshot(1);
  for (let index = 0; index < 500; index++) {
    const before = history.getSnapshot(1);
    history.editText(1, "text", revision("수정 " + index, 12 + index % 85));
    const after = history.getSnapshot(1); history.undo();
    assert.deepEqual(history.getSnapshot(1).elements, before.elements);
    history.redo(); assert.deepEqual(history.getSnapshot(1).elements, after.elements);
  }
  assert.equal(original.elements[0].text, "기존 제목");
});

test("opening and cancelling an edit session do not touch document history", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history), before = history.getSnapshot(1);
  const session = sessions.open(1, before.revision, "text", "session-1");
  assert.ok(Object.isFrozen(session)); assert.equal(sessions.cancel("wrong"), false);
  assert.equal(sessions.cancel(session.id), true); assert.equal(sessions.current, null);
  assert.strictEqual(history.getSnapshot(1), before);
  rejected(history, () => sessions.save(session.id, revision()), "stale-gesture");
});

test("a session cannot be replaced or retargeted by an overlapping editor request", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  sessions.open(1, history.getSnapshot(1).revision, "text", "first");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision, "text", "second"), e => e.reason === "unavailable");
  assert.equal(sessions.current.id, "first");
  rejected(history, () => sessions.save("second", revision()), "stale-gesture");
  sessions.save("first", revision()); assert.equal(sessions.current, null);
  rejected(history, () => sessions.save("first", revision()), "stale-gesture");
});

test("stale source revision rejects the complete save without losing the editor session", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  const session = sessions.open(1, history.getSnapshot(1).revision, "text", "first");
  history.translateElements(1, ["text"], 1, 1);
  rejected(history, () => sessions.save(session.id, revision()), "stale-document");
  assert.strictEqual(sessions.current, session);
});

test("invalid text remains retryable and a no-op save closes only its own session", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history), before = history.getSnapshot(1);
  const session = sessions.open(1, before.revision, "text", "first");
  rejected(history, () => sessions.save(session.id, revision(" ")), "invalid-element");
  assert.strictEqual(sessions.current, session);
  assert.deepEqual(sessions.save(session.id, { text: session.element.text, fontSize: 28, box }), { displayId: 1, changed: false });
  assert.strictEqual(history.getSnapshot(1), before); assert.equal(sessions.current, null);
});

test("session opening validates revision and the exact target type", () => {
  const history = setup(), sessions = new AnnotationTextEditSessions(history);
  for (const bad of [-1, 0.5, Infinity, NaN])
    assert.throws(() => sessions.open(1, bad, "text", "first"), e => e.reason === "invalid-element");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision - 1, "text", "first"), e => e.reason === "stale-document");
  assert.throws(() => sessions.open(1, history.getSnapshot(1).revision, "ink", "first"), e => e.reason === "invalid-element");
  assert.equal(sessions.current, null);
});
''')

write('src/electron/testing/text-edit-smoke.ts', '''import assert from "node:assert/strict";
import { globalShortcut } from "electron";
import type { AnnotationHistory, TextElement } from "../../annotation/history.js";
import { textControlPoints, framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand } from "../../shared/contract.js";
import { ACTIVE_COMMAND_SHORTCUTS } from "../annotation-shortcuts.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  activateSelection(): Promise<void>;
}

/** Real selection/editor buttons and Ctrl+Enter; insertText supplies Unicode, not a physical IME. */
export async function verifyExistingTextEditing(context: Context, displayId: number) {
  const controller = mainWindow;
  const index = overlayDisplays.findIndex(display => display.id === displayId);
  const overlay = overlayWindows[index];
  if (!controller || !overlay) throw new Error("Missing text editor test windows");
  const { history } = context;
  const state = () => history.getSnapshot(displayId);
  const query = (source: string) => controller.webContents.executeJavaScript(source);
  const overlayQuery = (source: string) => overlay.webContents.executeJavaScript(source);
  const ready = async () => waitFor(async () => Number(await overlayQuery(
    `document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision`)) === state().revision,
    5000, "text revision reaches overlay");
  const clickElement = async (selection: string, inController: boolean) => {
    const target = inController ? controller : overlay;
    const encoded = JSON.stringify(selection);
    const position = await target.webContents.executeJavaScript(`(() => {
      const node = document.querySelector(${encoded}); if (!node || node.disabled) return null;
      node.scrollIntoView({block:'nearest'}); const r = node.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if (!position) throw new Error("Unavailable text editing button: " + selection);
    const bounds = target.getContentBounds();
    await injectWindowsClick(Math.round(bounds.x + position.x), Math.round(bounds.y + position.y));
  };
  await context.activateSelection();
  history.clearDisplay(displayId);
  history.addElement(displayId, { id: "edit-text", tool: "text", text: "기존 제목", fontSize: 24,
    color: "#123456", opacity: 1, points: textControlPoints({ x: 120, y: 120 }),
    box: { minX: 0, minY: 0, maxX: 110, maxY: 34 } });
  history.rotateElements(displayId, ["edit-text"], { x: 120, y: 120 }, Math.PI / 6);
  history.resizeElements(displayId, ["edit-text"], { x: 120, y: 120 }, 1.3, 0.8);
  context.publishDocument(displayId); await ready();
  const original = state();
  async function openEditor() {
    controller.hide();
    const element = state().elements.find(item => item.id === "edit-text") as TextElement;
    const point = framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2);
    const bounds = overlay.getContentBounds();
    await injectWindowsClick(Math.round(bounds.x + point.x), Math.round(bounds.y + point.y));
    await waitFor(async () => Boolean(await overlayQuery(`document.querySelector('[data-selection-text-edit]:not(:disabled)')`)),
      5000, "one text enables re-edit");
    await clickElement("[data-selection-text-edit]", false);
    await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-existing-text-editor] textarea') === document.activeElement`)),
      5000, "controller re-edit autofocus");
    await waitFor(() => ACTIVE_COMMAND_SHORTCUTS.every(shortcut => !globalShortcut.isRegistered(shortcut.accelerator)),
      5000, "text editing releases document shortcuts");
  }
  async function setText(value: string) {
    await query(`(() => { const field = document.querySelector('[data-annotation-existing-text-editor] textarea'); field.focus(); field.select(); })()`);
    await controller.webContents.insertText(value);
    await waitFor(async () => await query(`document.querySelector('[data-annotation-existing-text-editor] textarea')?.value`) === value,
      5000, "Unicode replacement reaches controlled textarea");
  }
  async function closed() {
    await waitFor(async () => !await query(`Boolean(document.querySelector('[data-annotation-existing-text-editor]'))`), 5000, "editor closes");
    await ready();
  }
  await openEditor();
  const oldValue = await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`);
  assert.equal(oldValue, "기존 제목");
  await setText("임시 문자열");
  await injectWindowsShortcut("Ctrl+Z");
  await waitFor(async () => await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`) !== "임시 문자열", 5000, "editor-local Undo");
  assert.equal(state().revision, original.revision);
  const content = "수정된 제목" + String.fromCharCode(10) + "둘째 줄 ABC";
  await setText(content);
  await injectWindowsShortcut("Ctrl+Enter"); await closed();
  const edited = state();
  const editedText = edited.elements[0] as TextElement;
  assert.equal(editedText.text, content); assert.deepEqual(editedText.points, original.elements[0].points);
  assert.equal(editedText.color, original.elements[0].color); assert.equal(editedText.id, "edit-text");
  assert.equal(edited.revision, original.revision + 1);
  await context.command("undo"); await ready(); assert.deepEqual(state().elements, original.elements);
  await context.command("redo"); await ready(); assert.deepEqual(state().elements, edited.elements);

  await openEditor();
  const noOpRevision = state().revision;
  await injectWindowsShortcut("Ctrl+Enter"); await closed();
  assert.equal(state().revision, noOpRevision, "Identical text made an edit");

  await openEditor(); await setText("취소할 내용");
  await injectWindowsShortcut("Escape"); await closed();
  assert.deepEqual(state(), edited);

  await openEditor(); await setText("오래된 편집");
  history.translateElements(displayId, ["edit-text"], 7, 0); context.publishDocument(displayId); await ready();
  const external = state();
  await injectWindowsShortcut("Ctrl+Enter");
  await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-existing-text-editor] [role="status"]')?.textContent`)),
    5000, "stale text edit notice");
  assert.deepEqual(state(), external);
  assert.equal(await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`), "오래된 편집");
  await clickElement("[data-annotation-text-cancel]", true); await closed();

  await openEditor(); await setText("재로딩 중 초안");
  const loaded = new Promise<void>(resolve => controller.webContents.once("did-finish-load", () => resolve()));
  controller.webContents.reload(); await loaded;
  await waitFor(async () => Boolean(await query(`document.getElementById('root')?.childElementCount`)), 5000, "controller reload");
  assert.equal(await query(`Boolean(document.querySelector('[data-annotation-existing-text-editor]'))`), false);
  assert.equal(await query(`miniCast.getAnnotationTextEdit()`), null);
  assert.deepEqual(state(), external);

  const unauthorized = await overlayQuery(`miniCast.saveAnnotationTextEdit('not-a-controller', {})`);
  assert.equal(unauthorized.accepted, false); assert.deepEqual(state(), external);
  return { open: true, save: true, affinePreserved: true, undoRedo: true, editorUndo: true,
    noOp: true, cancel: true, staleRevision: true, controllerReload: true, senderRejected: true };
}
''')

change('src/electron/testing/interaction-smoke.ts', 'import { verifySelectionRotation }', '''import { verifyExistingTextEditing } from "./text-edit-smoke.js";
import { verifySelectionRotation }''')
change('src/electron/testing/interaction-smoke.ts', '''    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();''', '''      diagnostics.textEditingTools = await verifyExistingTextEditing({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for text editing");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for text editing");
          await waitFor(() => context.state().tool === "select", 5000, "text selection active");
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();''')

change('src/electron/testing/rendering-smoke.ts', '''        elements = []; compare('mixed-clear');''', '''        for (const angle of [0, Math.PI / 6]) {
          const saved = elements;
          const sourceText = rotateAnnotationElement(textElement, {x:30,y:20}, angle);
          elements = elements.map(item => item.id === sourceText.id ? sourceText : item); compare('before-text-edit-' + angle);
          const measured = createTextElement(a, 'measure-only', {text:'수정한 설명' + String.fromCharCode(10) + '두 번째 줄',fontSize:24}, {x:0,y:0}, '#1478AF');
          const replacement = replaceAnnotationText(sourceText, {text:measured.text,fontSize:measured.fontSize,box:measured.box});
          const beforeEdit = elements;
          elements = elements.map(item => item.id === sourceText.id ? replacement : item); compare('text-edit-' + angle);
          const afterEdit = elements;
          elements = beforeEdit; compare('undo-text-edit-' + angle);
          elements = afterEdit; compare('redo-text-edit-' + angle);
          elements = saved; compare('restore-text-edit-' + angle);
        }
        elements = []; compare('mixed-clear');''')
change('scripts/verify-diagnostics.ps1', '  Write-Host "ANNOTATION_CORE_DIAGNOSTICS', '''  foreach ($name in @('open','save','affinePreserved','undoRedo','editorUndo','noOp','cancel','staleRevision','controllerReload','senderRejected')) {
    if (-not $result.diagnostics.textEditingTools.$name) { throw "Missing existing-text editing verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS''')
change('scripts/verify-source.ps1', '''if (-not $payload.diagnostics.dirtyCanvasReference.success''', '''if (-not $payload.diagnostics.textEditingTools.save) { throw 'Existing-text editing was not verified.' }
if (-not $payload.diagnostics.dirtyCanvasReference.success''')

change('docs/ANNOTATION-TOOLS.md', '현재 문서 기준은 0.7.0입니다.', '현재 문서 기준은 0.8.0입니다.')
change('docs/ANNOTATION-TOOLS.md', '기존 텍스트 내용 재편집, 반전, 채우기, 레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.', '반전, 채우기, 레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.')
change('docs/ANNOTATION-TOOLS.md', '## 선택·이동·삭제', '''## 기존 텍스트 수정 (0.8.0)

선택 도구로 텍스트 하나를 고른 뒤 하단 ‘텍스트 수정’을 누릅니다. 기존 컨트롤러의 입력란에서 내용과 기본 글자 크기를 고치고 ‘수정 적용’ 또는 Ctrl+Enter로 저장합니다. 회전·기울어짐·확대 배율·위치·색상·객체 ID·겹침 순서는 유지하며 글자 배치 영역만 새 내용으로 다시 측정합니다. 글자 크기 변경은 기존 확대 배율에 추가로 적용됩니다.

입력란 Ctrl+Z는 입력 중 문자에만 적용하고, 저장된 내용 변경 전체는 문서 Undo 한 번으로 복원합니다. 변화 없는 저장은 문서 revision이나 Redo를 바꾸지 않습니다. 빈 내용은 저장하지 않으며 객체 제거에는 선택 삭제를 사용합니다. 입력 중 Escape와 ‘수정 취소’는 초안을 버리고 선택 모드를 유지합니다.

다른 편집으로 문서 revision이 바뀌면 오래된 저장을 거부하고 초안을 유지해 확인할 수 있게 합니다. 이 경우 취소 후 최신 객체를 다시 선택해야 합니다. 용량이나 좌표 한도를 넘는 변경은 기존 객체를 수정하지 않습니다. 도구 전환·컨트롤러 숨김/재로딩·화면 재구성은 미저장 편집을 취소합니다. 초안과 편집 세션은 디스크에 저장하지 않습니다.

## 선택·이동·삭제''')
change('README.md', '#', '#', count=read('README.md').count('#'))
write('docs/CHANGELOG.md', read('docs/CHANGELOG.md') + '''

## 0.8.0 — 기존 텍스트 재편집

- 선택한 텍스트를 컨트롤러에서 수정하며 위치·affine 프레임·스타일·ID·순서를 보존합니다.
- 글자 저장량을 변형 이력에서 원자적으로 갱신하고 용량·revision·세션 충돌을 거부합니다.
- 입력란 Undo, 저장/취소, 오래된 편집, 컨트롤러 reload, 부분 렌더링을 검증합니다.
''')

package = json.loads(read('package.json'))
package['version'] = '0.8.0'
package['scripts'].pop('precheck', None)
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')
lock = json.loads(read('package-lock.json'))
lock['version'] = '0.8.0'
lock['packages']['']['version'] = '0.8.0'
write('package-lock.json', json.dumps(lock, ensure_ascii=False, indent=2) + '\n')
subprocess.run(['git', 'add', 'package-lock.json'], check=True)
write('.git/hooks/prepare-commit-msg', '#!/bin/sh\nprintf "%s\\n" "feat: edit existing annotation text safely (0.8.0)" > "$1"\n')
for file in ['src/annotation/text-edit.ts', 'src/renderer/components/AnnotationExistingTextEditor.tsx',
             'src/electron/testing/text-edit-smoke.ts', 'tests/unit/annotation/text-edit.test.mjs']:
    if not Path(file).is_file(): raise RuntimeError('Missing prepared source: ' + file)
print('TEXT_EDIT_PREPARATION_COMPLETE version=0.8.0; native text editing diagnostics are mandatory')
"""
try:
    exec(compile(PREPARATION, '<reviewed-text-editing>', 'exec'))
except BaseException:
    # Keep this independent of partially modified package contents.
    current = json.loads(package_path.read_text(encoding='utf-8'))
    current['scripts']['precheck'] = guarded['scripts']['precheck']
    package_path.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    raise
