"""One-run preparation for the existing opt-in Windows verification job.
The job publishes product code only after all checks pass, then removes this file.
"""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import subprocess
import urllib.request

REPOSITORY = "andongmin94/mini-cast"
BASE = "1b3c808a143e913262fce8d0b13b2c1089d6a6a7"
FILES = {
    "src/annotation/resize.ts": "3e5a58cd021e8c154d29420b0068fedbff8b729c",
    "src/annotation/selection.ts": "621d104ffce5ba0e1902f17022b9e4f61c6c9a16",
    "src/renderer/components/AnnotationSelectionSurface.tsx": "9314b30d2a7942ad5b01da888d4af69def6d1802",
    "tests/unit/annotation/resize.test.mjs": "1ef19766101cbbadd272049ccd5f9c4441bf7e49",
    "src/electron/testing/resize-smoke.ts": "94856967a67c71d69087883f9724f1c7cd4b040b",
}
EDIT_PATHS = ["src/annotation/history.ts", "src/electron/testing/smoke.ts",
    "src/electron/testing/interaction-smoke.ts", "src/electron/testing/rendering-smoke.ts",
    "scripts/verify-diagnostics.ps1", "docs/ANNOTATION-TOOLS.md", "docs/CHANGELOG.md",
    "README.md", "package.json", "package-lock.json"]

def git(*args):
    return subprocess.check_output(["git", *args])

def fetch_blob(sha):
    request = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/git/blobs/{sha}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Reviewed-Source"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = base64.b64decode(json.load(response)["content"])
    actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if actual != sha:
        raise RuntimeError("Source blob checksum mismatch")
    return data.decode("utf-8")

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError("Reviewed replacement was not found exactly once: " + old[:120])
    return source.replace(old, new, 1)

if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or git("branch", "--show-current").decode().strip() != "main":
    raise RuntimeError("Unexpected repository or branch")
if git("status", "--porcelain").strip():
    raise RuntimeError("Refusing a dirty checkout")
# A shallow runner need not have BASE locally: check each reviewed baseline via the API.
request = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/git/trees/{BASE}?recursive=1",
    headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Reviewed-Source"})
with urllib.request.urlopen(request, timeout=30) as response:
    tree = json.load(response)
if tree.get("truncated"):
    raise RuntimeError("Incomplete baseline tree")
baseline = {item["path"]: item["sha"] for item in tree["tree"] if item["type"] == "blob"}
for name in [*FILES, *EDIT_PATHS]:
    if name in baseline:
        if git("rev-parse", "HEAD:" + name).decode().strip() != baseline[name]:
            raise RuntimeError("Source changed since review: " + name)
    elif Path(name).exists():
        raise RuntimeError("New destination already exists: " + name)
prepared = {name: fetch_blob(sha) for name, sha in FILES.items()}
for name in EDIT_PATHS:
    prepared[name] = git("show", "HEAD:" + name).decode("utf-8")

name = "src/annotation/history.ts"
s = prepared[name]
marker = "/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */"
helper = '''function validResizeTransform(anchor: AnnotationPoint, scaleX: number, scaleY: number) {
  return isFinitePoint(anchor) && Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX > 0 && scaleY > 0;
}

/** Same geometry for preview and commit. Bounds/width overflow rejects the edit;
 * it is never silently clamped into a different shape. */
export function resizeAnnotationElement(
  element: AnnotationElement, anchor: AnnotationPoint, scaleX: number, scaleY: number,
): AnnotationElement {
  if (!validResizeTransform(anchor, scaleX, scaleY) || !isAnnotationElement(element))
    throw new AnnotationError("invalid-element");
  if (scaleX === 1 && scaleY === 1) return element;
  const points = element.points.map(point => ({
    x: anchor.x + (point.x - anchor.x) * scaleX,
    y: anchor.y + (point.y - anchor.y) * scaleY,
  }));
  const resized: AnnotationElement = element.tool === "text"
    ? { ...element, points, scaleX: element.scaleX * scaleX, scaleY: element.scaleY * scaleY }
    : { ...element, points, width: element.width * Math.sqrt(scaleX * scaleY) };
  if (!isAnnotationElement(resized)) throw new AnnotationError("invalid-element");
  if (resized.tool === "text") {
    const point = resized.points[0];
    const edges = [point.x + resized.box.minX * resized.scaleX, point.x + resized.box.maxX * resized.scaleX,
      point.y + resized.box.minY * resized.scaleY, point.y + resized.box.maxY * resized.scaleY];
    if (edges.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_ANNOTATION_COORDINATE))
      throw new AnnotationError("invalid-element");
  }
  return immutableElement(resized);
}

'''
s = replace_once(s, marker, helper + marker)
start = s.index("  translateElements(displayId:")
end = s.index("\n  clearDisplay(displayId:", start)
s = s[:start] + '''  translateElements(displayId: number, ids: Iterable<string>, dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, dx === 0 && dy === 0,
      element => translateAnnotationElement(element, dx, dy));
  }

  resizeElements(displayId: number, ids: Iterable<string>, anchor: AnnotationPoint, scaleX: number, scaleY: number) {
    if (!validResizeTransform(anchor, scaleX, scaleY)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, scaleX === 1 && scaleY === 1,
      element => resizeAnnotationElement(element, anchor, scaleX, scaleY));
  }

  /** Build and validate every destination before replacing any source geometry. */
  private transformElements(displayId: number, ids: Iterable<string>, identity: boolean,
    transform: (element: AnnotationElement) => AnnotationElement) {
    const values = [...ids];
    const validIds = readAnnotationElementIds(values);
    if (!validIds || validIds.length !== values.length) throw new AnnotationError("invalid-element");
    if (!validIds.length) return null;
    const document = this.document(displayId);
    if (validIds.some(id => !document.elementIds.has(id))) throw new AnnotationError("stale-document");
    if (identity) return null;
    const selected = new Set(validIds);
    const changes = document.elements.flatMap((before, index) => selected.has(before.id)
      ? [{ index, before, after: transform(before) }] : []);
    const entry: TransformHistoryEntry = { kind: "transform", displayId, changes };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }
''' + s[end:]
# The existing move history is generalized, rather than adding a second parallel undo path.
s = s.replace("MoveHistoryEntry", "TransformHistoryEntry").replace('"move"', '"transform"').replace("applyMove", "applyTransform")
s = re.sub(r"\bmoves\b", "changes", s)
s = re.sub(r"\bmove\b", "change", s)
prepared[name] = s

name = "src/electron/testing/smoke.ts"
s = prepared[name]
start = s.index("export function injectWindowsDrag(")
end = s.index("\nexport function shortcutVirtualKeys", start)
s = s[:start] + '''export function injectWindowsDrag(
  startX: number, startY: number, endX: number, endY: number,
  modifiers: readonly "Shift"[] = [],
) {
  const steps = 12;
  const movements = Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    return `[MiniCastMouse]::SetCursorPos(${x}, ${y}) | Out-Null\\nStart-Sleep -Milliseconds 20`;
  }).join("\\n");
  const keys = modifiers.map(key => shortcutVirtualKeys(key)[0]);
  const press = keys.map(key => `[MiniCastKeyboard]::Key(${key}, $false)`).join("\\n");
  const release = [...keys].reverse().map(key => `[MiniCastKeyboard]::Key(${key}, $true)`).join("\\n");
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
${keys.length ? KEY_NATIVE_DECLARATION : ""}
try {
${press}
[MiniCastMouse]::SetCursorPos(${Math.round(startX)}, ${Math.round(startY)}) | Out-Null
Start-Sleep -Milliseconds 100
[MiniCastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
${movements}
} finally {
[MiniCastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
${release}
}
`);
}
''' + s[end:]
prepared[name] = s

name = "src/electron/testing/interaction-smoke.ts"
s = 'import { verifySelectionResize } from "./resize-smoke.js";\n' + prepared[name]
s = replace_once(s, "      await verifySelectionTools(primary.id, start, end);", '''      await verifySelectionTools(primary.id, start, end);
      diagnostics.resizeTools = await verifySelectionResize({
        history: annotationHistory, publishDocument: context.publishDocument,
        command: shortcutCommand, state: context.state,
      }, primary.id);''')
prepared[name] = s

name = "src/electron/testing/rendering-smoke.ts"
s = replace_once(prepared[name], '["text", "shape-geometry", "render-plan", "canvas-renderer"]',
    '["errors", "text", "history", "shape-geometry", "render-plan", "canvas-renderer"]')
marker = "        elements = []; compare('mixed-clear');"
addition = '''        // Exercise the actual resize helper, including text overhang, alpha and
        // same-ID dirty invalidation at five backing-store ratios.
        for (const item of [...shapeSet, textElement, bottom, top]) {
          for (const [sx, sy] of [[1.3, 0.7], [0.6, 1.4], [1.25, 1.25]]) {
            const saved = elements;
            elements = elements.map(element => element.id === item.id
              ? resizeAnnotationElement(element, { x: 30.25, y: 20.75 }, sx, sy) : element);
            compare('resize-' + item.tool + '-' + sx + '-' + sy);
            const resized = elements;
            elements = saved; compare('undo-resize-' + item.tool);
            elements = resized; compare('redo-resize-' + item.tool);
            elements = saved; compare('restore-resize-' + item.tool);
          }
        }
'''
s = replace_once(s, marker, addition + marker)
prepared[name] = s

name = "scripts/verify-diagnostics.ps1"
marker = '  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"'
prepared[name] = replace_once(prepared[name], marker, '''  foreach ($name in @('handles','noOp','resize','undoRedo','groupShift','pixels','heldUndo','staleRevision','activeReload','heldEscape')) {
    if (-not $result.diagnostics.resizeTools.$name) { throw "Missing resize verification: $name" }
  }
''' + marker)

name = "docs/ANNOTATION-TOOLS.md"
s = prepared[name].replace("크기 변경·회전·기존 텍스트 재편집은 아직 지원하지 않습니다.", "크기 변경을 지원합니다. 회전·기존 텍스트 재편집은 아직 지원하지 않습니다.")
s += '''

## 선택 크기 조절 (0.6.0)

선택한 객체의 네 모서리에 나타나는 흰색 핸들을 드래그합니다. Shift를 누르고 드래그하면 가로·세로 비율을 유지합니다. Shift+클릭으로 고른 여러 객체도 한 그룹으로 크기를 바꿉니다. 반대 모서리를 기준으로 원래 문서의 좌표를 변환하고, 이전 프레임의 미리보기를 다시 확대하지 않습니다.

펜·형광펜·도형은 좌표와 함께 선 굵기를 가로 배율과 세로 배율의 기하평균만큼 바꿉니다. 비균등 확대에서도 선 굵기는 단일 값이며 비틀린 펜촉으로 변환하지 않습니다. 텍스트는 내용·기본 글자 크기를 유지하고 레이아웃의 가로·세로 배율을 바꿉니다. 모서리를 반대편 너머로 끌어도 뒤집거나 0 크기로 만들지 않습니다. 최소 범위에서 멈추며, 좌표·선 굵기·텍스트 배율의 허용 한도를 넘으면 전체 조절을 취소하고 알립니다.

크기 조절 한 번은 그룹 전체에 대해 한 번의 Undo입니다. 단순 핸들 클릭은 이력이나 Redo를 바꾸지 않습니다. 조절 중 Ctrl+Z는 현재 미리보기만 취소하고, Escape는 클릭 통과로 돌아갑니다. 다른 편집이나 화면 재설정으로 revision이 바뀌면 오래된 크기 조절은 거부합니다. 재로딩 중인 미완성 조절과 선택 핸들은 버리고 확정된 문서는 유지합니다.

`tests/unit/annotation/resize.test.mjs`는 네 모서리·비율·최소 크기·원자적 거부·문서 이력·viewport·동기화를 검사합니다. Windows 검증은 실제 핸들 드래그와 Shift 그룹 조절, Undo/Redo, 미리보기의 픽셀 복원, 오래된 revision, 드래그 중 reload와 Escape를 검사합니다. 회전·반전·기존 텍스트 내용 편집은 이번 범위가 아닙니다.
'''
prepared[name] = s
prepared["README.md"] += "\n선택한 객체는 네 모서리 핸들로 크기를 조절합니다. Shift로 비율을 유지하며 그룹 조절도 한 번에 실행취소합니다. 자세한 동작은 [판서 도구 가이드](docs/ANNOTATION-TOOLS.md)를 참고합니다.\n"
heading, rest = prepared["docs/CHANGELOG.md"].split("\n", 1)
prepared["docs/CHANGELOG.md"] = heading + "\n\n## 0.6.0 선택 크기 조절\n\n네 모서리 핸들, Shift 비율 고정, 다중 선택 크기 조절을 추가했습니다. 이동과 크기 조절은 같은 변형 이력으로 관리하고, 오래된 문서·허용 범위 초과를 전체 작업 단위로 거부합니다. 실제 Windows 입력과 부분 Canvas 재그리기 검증을 확장했습니다.\n" + rest
for name in ("package.json", "package-lock.json"):
    package = json.loads(prepared[name])
    if package["version"] != "0.5.0":
        raise RuntimeError("Unexpected package version")
    package["version"] = "0.6.0"
    if name == "package-lock.json":
        package["packages"][""]["version"] = "0.6.0"
    prepared[name] = json.dumps(package, ensure_ascii=False, indent=2) + "\n"

# Nothing is written until every baseline, blob and exact replacement passed.
for name, content in prepared.items():
    path = Path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
subprocess.run(["git", "add", "package-lock.json"], check=True)
hook = Path(git("rev-parse", "--git-path", "hooks/prepare-commit-msg").decode().strip())
hook.parent.mkdir(parents=True, exist_ok=True)
hook.write_text('#!/bin/sh\nprintf "%s\\n" "feat: add transactional selection resize handles (0.6.0)" > "$1"\n', encoding="utf-8", newline="\n")
hook.chmod(0o755)
Path("verification-logs").mkdir(exist_ok=True)
Path("verification-logs/source-preparation.json").write_text(json.dumps({
    "base": BASE, "checkout": git("rev-parse", "HEAD").decode().strip(), "version": "0.6.0",
    "files": {name: hashlib.sha256(content.encode()).hexdigest() for name, content in prepared.items()},
}, indent=2), encoding="utf-8")
print("Prepared transactional selection resizing. Native Windows, package and integrity checks are required before publication.")
