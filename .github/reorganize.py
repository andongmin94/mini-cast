"""One-run preparation. The existing opt-in job validates all changes then removes this file."""
from pathlib import Path
import base64
import hashlib
import json
import os
import subprocess
import urllib.request

REPO = "andongmin94/mini-cast"
BASE = "e553690c755ffe9a1bba1cf828a5862c4396f007"
NEW = {
    "src/annotation/selection.ts": "62e3d52bcd1844e5467a7a81c033b295cdc1aa0f",
    "src/renderer/components/AnnotationSelectionSurface.tsx": "ed6a50f3f8f9b2cf53644a7aca6f6287a75e4541",
    "tests/unit/annotation/selection.test.mjs": "a4139111fbde8c46786cdedb5bd748367bfb9ca3",
}

def git(*args):
    return subprocess.check_output(["git", *args])

def request(path):
    req = urllib.request.Request("https://api.github.com/repos/" + REPO + path,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Verified-Source"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def blob_id(content):
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()

def blob(sha):
    data = base64.b64decode(request("/git/blobs/" + sha)["content"])
    if blob_id(data) != sha:
        raise RuntimeError("Source transport integrity error")
    return data.decode("utf-8")

if os.environ.get("GITHUB_REPOSITORY") != REPO or git("branch", "--show-current").decode().strip() != "main":
    raise RuntimeError("Wrong repository or branch")
if git("status", "--porcelain").strip():
    raise RuntimeError("Working tree is not clean")
baseline_tree = request("/git/trees/" + BASE + "?recursive=1")
if baseline_tree.get("truncated"):
    raise RuntimeError("Incomplete baseline tree")
baseline = {entry["path"]: entry["sha"] for entry in baseline_tree["tree"] if entry["type"] == "blob"}
prepared = {}

def read(name):
    if name in prepared:
        return prepared[name]
    data = git("show", "HEAD:" + name)
    if blob_id(data) != baseline.get(name):
        raise RuntimeError("File changed since review: " + name)
    prepared[name] = data.decode("utf-8")
    return prepared[name]

def replace(name, old, new):
    source = read(name)
    if source.count(old) != 1:
        raise RuntimeError("Expected exactly one patch target: " + name + " / " + old[:80])
    prepared[name] = source.replace(old, new, 1)

for name, sha in NEW.items():
    if Path(name).exists():
        raise RuntimeError("New source destination exists: " + name)
    prepared[name] = blob(sha)

ui = "src/renderer/components/AnnotationSelectionSurface.tsx"
replace(ui, "useCallback, useEffect, useLayoutEffect", "useCallback, useLayoutEffect")
replace(ui, "(document?.displayId !== drag.current.source.displayId || document.revision !== drag.current.source.revision)",
    "(!document || document.displayId !== drag.current.source.displayId || document.revision !== drag.current.source.revision)")
replace(ui, "    resize();\n    const observer", """    resize();
    const generation = epoch.current;
    const refreshFonts = () => {
      if (!alive.current || epoch.current !== generation) return;
      rendered.current = null;
      requestPaint();
    };
    void window.document.fonts.load('400 28px "Pretendard"', '한글 ABC').then(refreshFonts).catch(() => {
      if (alive.current && epoch.current === generation) setNotice("글꼴을 불러오지 못했습니다. 텍스트 표시를 확인해 주세요.");
    });
    window.document.fonts.addEventListener("loadingdone", refreshFonts);
    const observer""")
replace(ui, '      observer.disconnect();', '      observer.disconnect();\n      window.document.fonts.removeEventListener("loadingdone", refreshFonts);')

history = "src/annotation/history.ts"
replace(history, "type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry;", """interface MoveHistoryEntry {
  kind: "move";
  displayId: number;
  moves: readonly {
    index: number;
    before: AnnotationElement;
    after: AnnotationElement;
  }[];
}

type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry | MoveHistoryEntry;""")
replace(history, "function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {", """/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */
export function translateAnnotationElement(element: AnnotationElement, dx: number, dy: number): AnnotationElement {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new AnnotationError("invalid-element");
  const points = Object.freeze(element.points.map(point => {
    const x = point.x + dx;
    const y = point.y + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_ANNOTATION_COORDINATE || Math.abs(y) > MAX_ANNOTATION_COORDINATE)
      throw new AnnotationError("invalid-element");
    return Object.freeze({ x, y });
  }));
  return element.tool === "text"
    ? Object.freeze({ ...element, points, box: Object.isFrozen(element.box) ? element.box : Object.freeze({ ...element.box }) })
    : Object.freeze({ ...element, points });
}

function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.kind === "move") return { ...entry, moves: entry.moves.map(move => ({ ...move })) };""")
replace(history, '  if (entry.displayId !== displayId) return entry;\n  if (entry.kind === "add") {', """  if (entry.displayId !== displayId) return entry;
  if (entry.kind === "move") return { ...entry, moves: entry.moves.map(move => ({
    index: move.index,
    before: scaleElement(move.before, scaleX, scaleY),
    after: scaleElement(move.after, scaleX, scaleY),
  })) };
  if (entry.kind === "add") {""")
replace(history, "function historyEntryPointCount(entry: HistoryEntry) {", """function historyEntryPointCount(entry: HistoryEntry) {
  // Account for displaced geometry. Destinations are shared with the current
  // document or a following history entry, rather than copied for each owner.
  if (entry.kind === "move") return entry.moves.reduce((sum, move) => sum + annotationElementCost(move.before), 0);""")
replace(history, "  clearDisplay(displayId: number) {", """  translateElements(displayId: number, ids: Iterable<string>, dx: number, dy: number) {
    const values = [...ids];
    const validIds = readAnnotationElementIds(values);
    if (!validIds || validIds.length !== values.length || !Number.isFinite(dx) || !Number.isFinite(dy))
      throw new AnnotationError("invalid-element");
    if (!validIds.length) return null;
    const document = this.document(displayId);
    if (validIds.some(id => !document.elementIds.has(id))) throw new AnnotationError("stale-document");
    if (dx === 0 && dy === 0) return null;
    const selected = new Set(validIds);
    const moves = document.elements.flatMap((before, index) => selected.has(before.id)
      ? [{ index, before, after: translateAnnotationElement(before, dx, dy) }] : []);
    const entry: MoveHistoryEntry = { kind: "move", displayId, moves };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  clearDisplay(displayId: number) {""")
replace(history, '  private apply(entry: HistoryEntry) {\n    const document = this.document(entry.displayId);', """  private apply(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "move") {
      this.applyMove(entry, false);
      return;
    }""")
replace(history, '  private revert(entry: HistoryEntry) {\n    const document = this.document(entry.displayId);', """  private applyMove(entry: MoveHistoryEntry, undo: boolean) {
    const document = this.document(entry.displayId);
    if (entry.moves.some(move => document.elements[move.index]?.id !== move.before.id))
      throw new AnnotationError("stale-document");
    const elements = document.elements.slice();
    for (const move of entry.moves) elements[move.index] = undo ? move.before : move.after;
    document.elements = elements;
    this.touch(entry.displayId);
  }

  private revert(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "move") {
      this.applyMove(entry, true);
      return;
    }""")

errors = "src/annotation/errors.ts"
replace(errors, '  | "stale-gesture"', '  | "stale-gesture"\n  | "stale-document"')
replace(errors, 'const DOMAIN_MESSAGES = {', 'const DOMAIN_MESSAGES = {\n  "stale-document": "Annotation document changed during editing",')
replace(errors, '  switch (reason) {', '  switch (reason) {\n    case "stale-document":\n      return "판서가 변경되어 이전 선택으로 편집하지 않았습니다. 객체를 다시 선택해 주세요.";')
replace("src/shared/contract.ts", '  "pass-through",', '  "pass-through",\n  "select",')
api = "src/shared/electron-api.d.ts"
replace(api, 'import type { AnnotationTextDraft }', 'import type { AnnotationSelectionEdit } from "../annotation/selection";\nimport type { AnnotationTextDraft }')
replace(api, '  endAnnotationGesture(gestureId: string): void;', '  editAnnotationSelection(gestureId: string, edit: AnnotationSelectionEdit): Promise<AnnotationMutationResult>;\n  endAnnotationGesture(gestureId: string): void;')
replace("src/electron/preload.cts", '  endAnnotationGesture: (gestureId: unknown) =>', '  editAnnotationSelection: (gestureId: unknown, edit: unknown) =>\n    ipcRenderer.invoke("annotation-edit-selection", gestureId, edit),\n  endAnnotationGesture: (gestureId: unknown) =>')

main = "src/electron/main.ts"
replace(main, 'import { readAnnotationTextDraft,', 'import { applyAnnotationSelectionEdit } from "../annotation/selection.js";\nimport { readAnnotationTextDraft,')
replace(main, '  ipcMain.handle("get-annotation-document", (event) => {', """  ipcMain.handle("annotation-edit-selection", (event, gestureId: unknown, value: unknown): AnnotationMutationResult => {
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

  ipcMain.handle("get-annotation-document", (event) => {""")

controls = "src/renderer/components/AnnotationControls.tsx"
replace(controls, '  { tool: "pen", label:', '  { tool: "select", label: "선택", shortcut: "클릭 · Shift 추가 선택 · 드래그 이동", Icon: MousePointer2 },\n  { tool: "pen", label:')
replace(controls, '<div className="grid grid-cols-3 gap-2">\n        {TOOL_OPTIONS', '<div className="grid grid-cols-5 gap-2">\n        {TOOL_OPTIONS')
overlay = "src/renderer/components/Overlay.tsx"
replace(overlay, 'import AnnotationSurface from', 'import AnnotationSelectionSurface from "@/renderer/components/AnnotationSelectionSurface";\nimport AnnotationSurface from')
replace(overlay, '      <AnnotationSurface\n        tool={annotationState.tool}', '''      {annotationState.tool === "select" ? (
        <AnnotationSelectionSurface key={displayId} displayId={displayId}
          document={annotationDocument} onDocumentUpdate={applyAnnotationUpdate} />
      ) : <AnnotationSurface
        tool={annotationState.tool}''')
replace(overlay, '        onDocumentUpdate={applyAnnotationUpdate}\n      />', '        onDocumentUpdate={applyAnnotationUpdate}\n      />}')

smoke = "src/electron/testing/interaction-smoke.ts"
replace(smoke, '  interface SmokeState {', blob("20f12c63d1b8e488a76861017c2374d2dd3fb661") + '  interface SmokeState {')
replace(smoke, '!Boolean(await query("document.querySelector(\'[data-active-gesture]\')"))', '!(await query("document.querySelector(\'[data-active-gesture]\')"))')
replace(smoke, '      await verifyShapeAndTextTools(primary.id, start, end);', '      await verifyShapeAndTextTools(primary.id, start, end);\n      await verifySelectionTools(primary.id, start, end);')
render_smoke = "src/electron/testing/rendering-smoke.ts"
replace(render_smoke, "        elements = []; compare('mixed-clear');", """        for (const moved of [...shapeSet, textElement, bottom, top]) {
          const saved = elements;
          elements = elements.map(element => element.id === moved.id ? { ...element,
            points: element.points.map(point => ({ x: point.x + 17.25, y: point.y - 11.5 })) } : element);
          compare('move-' + moved.tool);
          elements = saved; compare('undo-move-' + moved.tool);
        }
        elements = []; compare('mixed-clear');""")
verify = "scripts/verify-diagnostics.ps1"
replace(verify, "  Write-Host \"ANNOTATION_CORE_DIAGNOSTICS", """  foreach ($name in @('topmost','move','undoRedo','delete','heldUndo','staleRevision','reload')) {
    if (-not $result.diagnostics.selectionTools.$name) { throw "Missing selection verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS""")

readme = "README.md"
replace(readme, '- 직선 · 화살표 · 사각형 · 타원 · 한글/여러 줄 텍스트', '- 직선 · 화살표 · 사각형 · 타원 · 한글/여러 줄 텍스트\n- 객체 선택 · Shift 추가 선택 · 그룹 이동 · 선택 삭제')
doc = "docs/ANNOTATION-TOOLS.md"
replace(doc, '확정한 객체를 다시 선택해 이동·회전·크기 변경하거나 기존 텍스트를 다시 편집하는 기능은 이번 범위가 아닙니다.', '객체 선택·이동·선택 삭제는 지원합니다. 크기 변경·회전·기존 텍스트 재편집은 아직 지원하지 않습니다.')
prepared[doc] += """
## 선택·이동·삭제 (0.5.0)

컨트롤러의 ‘선택’ 도구를 누른 뒤 객체를 클릭합니다. 겹친 객체는 맨 위의 선·글자부터 선택하며 빈 사각형·타원의 내부는 선택하지 않습니다. Shift+클릭으로 같은 모니터 안의 객체를 추가하거나 제외하고, 선택한 객체를 드래그하면 선택한 그룹이 함께 이동합니다. 빈 곳을 클릭하면 선택을 해제합니다.

선택 모드 하단의 ‘선택 삭제’는 선택한 객체만 삭제합니다. Delete 키는 등록하지 않으므로 다른 프로그램의 삭제 단축키를 가로채지 않습니다. 기존 Ctrl+Z/다시 실행은 이동과 삭제에도 적용합니다. 단순 클릭·선택 해제·미세한 드래그는 이력을 만들지 않습니다. 이동 중 Ctrl+Z는 진행 중 이동만 취소하고, Escape는 클릭 통과로 돌아갑니다.

선택은 모니터별 임시 상태입니다. 도구 전환이나 renderer 재로딩에서는 선택을 초기화하고 확정된 문서는 유지합니다. 이동은 원래 ID·순서·색상·굵기·텍스트 내용을 그대로 보존합니다. 이동 한 번은 하나의 전역 Undo 항목이며, 다른 편집이나 화면 재설정으로 문서 revision이 바뀌었다면 오래된 선택 편집은 거부합니다.

검증 코드는 실제 Windows 클릭·드래그·Ctrl+Z·선택 삭제 버튼·renderer reload 및 stale revision 거부를 확인합니다. 각 실행의 성공 여부는 해당 진단 로그를 기준으로 판단합니다.
"""
changelog = "docs/CHANGELOG.md"
source = read(changelog)
first, rest = source.split("\n", 1)
prepared[changelog] = first + "\n\n## 0.5.0 선택 편집\n\n객체 선택·Shift 추가 선택·그룹 이동·선택 삭제를 기존 문서와 전역 Undo/Redo에 통합했습니다. 객체 ID·순서·스타일을 유지하며 오래된 revision의 편집을 거부합니다. 크기 조절·회전·기존 텍스트 재편집은 이번 범위에 포함하지 않습니다.\n" + rest
for name in ("package.json", "package-lock.json"):
    package = json.loads(read(name))
    if package["version"] != "0.4.0":
        raise RuntimeError("Unexpected package version")
    package["version"] = "0.5.0"
    if name == "package-lock.json":
        package["packages"][""]["version"] = "0.5.0"
    prepared[name] = json.dumps(package, ensure_ascii=False, indent=2) + "\n"

for name, source in prepared.items():
    target = Path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8", newline="\n")
subprocess.run(["git", "add", "package-lock.json"], check=True)
hook = Path(git("rev-parse", "--git-path", "hooks/prepare-commit-msg").decode().strip())
hook.parent.mkdir(parents=True, exist_ok=True)
hook.write_text('#!/bin/sh\nprintf "%s\\n" "feat: add transactional annotation selection and movement (0.5.0)" > "$1"\n', encoding="utf-8", newline="\n")
hook.chmod(0o755)
Path("verification-logs").mkdir(exist_ok=True)
Path("verification-logs/source-preparation.json").write_text(json.dumps({
    "base": BASE, "checkout": git("rev-parse", "HEAD").decode().strip(), "version": "0.5.0",
    "files": {name: hashlib.sha256(source.encode()).hexdigest() for name, source in prepared.items()},
}, indent=2), encoding="utf-8")
print("Prepared selection editing. All Windows checks must pass before publication.")
