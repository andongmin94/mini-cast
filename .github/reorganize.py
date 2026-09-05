"""Apply the reviewed editable-file increment. Removed after successful verification."""
from pathlib import Path
import json
import subprocess

BASE = '04f13d9ecda929c55892100ebfaf50ff073c6b08'
MODULES = 'a67b9891538b14b43416f61f92755218aeccbfd2'
guard = json.loads(Path('package.json').read_text(encoding='utf-8'))
guard['scripts']['check'] = 'node -e "throw new Error(\'Editable file preparation incomplete\')"'
Path('package.json').write_text(json.dumps(guard, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
subprocess.run(['git','fetch','--depth=1','origin',BASE],check=True)
subprocess.run(['git','diff','--exit-code',BASE,'HEAD','--','.',':!.github/reorganize.py'],check=True)
subprocess.run(['git','fetch','--depth=1','origin',MODULES],check=True)
def source(path): return subprocess.check_output(['git','show',BASE+':'+path]).decode('utf-8')
files = {}
def replace(path,old,new,count=1):
    text=files[path] if path in files else source(path)
    if text.count(old)!=count: raise RuntimeError(f'{path}: expected {count} anchors, got {text.count(old)}: {old[:90]!r}')
    files[path]=text.replace(old,new)
new_files = [
 'src/annotation/document-file.ts',
 'src/electron/annotation-io-gate.ts','src/electron/annotation-file-store.ts','src/electron/annotation-files.ts',
 'src/renderer/components/AnnotationFileControls.tsx','src/electron/testing/document-file-smoke.ts',
 'tests/unit/annotation/document-file.test.mjs','tests/unit/electron/annotation-file-store.test.mjs',
]
for path in new_files:
    if Path(path).exists(): raise RuntimeError('Target already exists: '+path)
    files[path]=subprocess.check_output(['git','show',MODULES+':'+path]).decode('utf-8')
replace('src/annotation/document-file.ts','Object.hasOwn(value, key)','Object.prototype.hasOwnProperty.call(value, key)')
replace('tests/unit/annotation/document-file.test.mjs','createAnnotationUpdate, applyAnnotationUpdate','createAnnotationUpdate, reduceAnnotationUpdate')
replace('tests/unit/annotation/document-file.test.mjs','applyAnnotationUpdate(before, update)','reduceAnnotationUpdate(before, 1, update).document')
replace('tests/unit/annotation/document-file.test.mjs','applyAnnotationUpdate(opened, createAnnotationUpdate(opened, undone))','reduceAnnotationUpdate(opened, 1, createAnnotationUpdate(opened, undone)).document')

path='src/annotation/history.ts'
replace(path,'type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry | TransformHistoryEntry;', '''interface ReplaceHistoryEntry {
  kind: "replace";
  displayId: number;
  before: readonly AnnotationElement[];
  after: readonly AnnotationElement[];
}

type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry | TransformHistoryEntry | ReplaceHistoryEntry;''')
replace(path,'function scaleElement(element: AnnotationElement, scaleX: number, scaleY: number): AnnotationElement {', '''/** Validate a complete bounded collection before taking ownership of any data. */
export function copyAnnotationElements(value: unknown): readonly AnnotationElement[] {
  if (!Array.isArray(value)) throw new AnnotationError("invalid-element");
  if (value.length > MAX_ANNOTATION_ELEMENTS_PER_DISPLAY) throw new AnnotationError("element-limit");
  const ids = new Set<string>();
  let points = 0;
  for (const element of value) {
    if (!isAnnotationElement(element)) throw new AnnotationError("invalid-element");
    for (const point of element.points) if (!isFinitePoint(point)) throw new AnnotationError("invalid-element");
    if (ids.has(element.id)) throw new AnnotationError("duplicate-element");
    ids.add(element.id);
    points += annotationElementCost(element);
    if (points > MAX_ANNOTATION_POINTS_PER_DISPLAY) throw new AnnotationError("point-limit");
  }
  return Object.freeze(value.map(immutableElement));
}

function sameAnnotationElements(left: readonly AnnotationElement[], right: readonly AnnotationElement[]) {
  return left.length === right.length && left.every((a, index) => {
    const b = right[index];
    if (a === b) return true;
    if (a.id !== b.id || a.tool !== b.tool || a.color !== b.color || a.opacity !== b.opacity ||
        a.points.length !== b.points.length || !a.points.every((point, i) => point.x === b.points[i].x && point.y === b.points[i].y)) return false;
    if (a.tool === "text") return b.tool === "text" && a.text === b.text && a.fontSize === b.fontSize &&
      a.box.minX === b.box.minX && a.box.minY === b.box.minY && a.box.maxX === b.box.maxX && a.box.maxY === b.box.maxY;
    return b.tool !== "text" && a.width === b.width &&
      ("fill" in a ? a.fill : undefined) === ("fill" in b ? b.fill : undefined);
  });
}

function scaleElement(element: AnnotationElement, scaleX: number, scaleY: number): AnnotationElement {''')
replace(path,'function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {','''function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.kind === "replace") return { ...entry };''')
replace(path,'  if (entry.displayId !== displayId) return entry;','''  if (entry.displayId !== displayId) return entry;
  if (entry.kind === "replace") return { ...entry,
    before: Object.freeze(entry.before.map(element => scaleElement(element, scaleX, scaleY))),
    after: Object.freeze(entry.after.map(element => scaleElement(element, scaleX, scaleY))),
  };''')
replace(path,'function historyEntryPointCount(entry: HistoryEntry) {','''function historyEntryPointCount(entry: HistoryEntry) {
  // Either side may become the displaced document after Undo. Keep the newest
  // full-budget replacement undoable without undercounting the larger side.
  if (entry.kind === "replace") return Math.max(
    entry.before.reduce((sum, element) => sum + annotationElementCost(element), 0),
    entry.after.reduce((sum, element) => sum + annotationElementCost(element), 0),
  );''')
replace(path,'  addElement(displayId: number, stroke: AnnotationElement) {','''  /** One complete, undoable replacement; failed validation never changes the document. */
  replaceDocumentElements(displayId: number, value: unknown, expectedRevision: number) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        (this.revisions.get(displayId) ?? 0) !== expectedRevision) throw new AnnotationError("stale-document");
    const after = copyAnnotationElements(value);
    const document = this.document(displayId);
    if (sameAnnotationElements(document.elements, after)) return null;
    const entry: ReplaceHistoryEntry = { kind: "replace", displayId,
      before: Object.freeze(document.elements.slice()), after };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  addElement(displayId: number, stroke: AnnotationElement) {''')
replace(path,'  private apply(entry: HistoryEntry) {\n    const document = this.document(entry.displayId);','''  private apply(entry: HistoryEntry) {
    if (entry.kind === "replace") { this.applyDocumentReplacement(entry, false); return; }
    const document = this.document(entry.displayId);''')
replace(path,'  private revert(entry: HistoryEntry) {\n    const document = this.document(entry.displayId);','''  private revert(entry: HistoryEntry) {
    if (entry.kind === "replace") { this.applyDocumentReplacement(entry, true); return; }
    const document = this.document(entry.displayId);''')
replace(path,'  private applyTransform(entry: TransformHistoryEntry, undo: boolean) {','''  private applyDocumentReplacement(entry: ReplaceHistoryEntry, undo: boolean) {
    const document = this.document(entry.displayId);
    if (!sameAnnotationElements(document.elements, undo ? entry.after : entry.before))
      throw new AnnotationError("stale-document");
    const elements = undo ? entry.before : entry.after;
    document.elements = elements.slice();
    document.elementIds = new Set(elements.map(element => element.id));
    document.pointCount = elements.reduce((sum, element) => sum + annotationElementCost(element), 0);
    this.touch(entry.displayId);
  }

  private applyTransform(entry: TransformHistoryEntry, undo: boolean) {''')

path='src/electron/annotation-export.ts'
files[path]='import type { AnnotationIoGate } from "./annotation-io-gate.js";\n'+source(path)
replace(path,'interface Options {\n  history: AnnotationHistory;','interface Options {\n  gate: AnnotationIoGate;\n  history: AnnotationHistory;')
replace(path,'  let busy = false;\n','')
replace(path,'    if (busy) return { status: "error", reason: "busy" };','    if (options.gate.busy) return { status: "error", reason: "busy" };')
replace(path,'    busy = true;','    const release = options.gate.acquire();\n    if (!release) return { status: "error", reason: "busy" };')
replace(path,'      busy = false;','      release();')
path='src/electron/main.ts'
files[path]='import { AnnotationIoGate } from "./annotation-io-gate.js";\nimport { registerAnnotationFiles } from "./annotation-files.js";\n'+source(path)
replace(path,'const annotationHistory = new AnnotationHistory();','const annotationHistory = new AnnotationHistory();\nconst annotationIo = new AnnotationIoGate();')
replace(path,'function setAnnotationTool(tool: AnnotationTool) {','''function setAnnotationTool(tool: AnnotationTool) {
  if (annotationIo.busy && tool !== "pass-through") { sendAnnotationState(); return; }''')
replace(path,'  registerAnnotationExports({\n    history: annotationHistory,','''  registerAnnotationFiles({
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
    history: annotationHistory,''')
path='src/electron/preload.cts'
replace(path,'contextBridge.exposeInMainWorld("miniCast", {','''contextBridge.exposeInMainWorld("miniCast", {
  annotationFile: (request: unknown) => ipcRenderer.invoke("annotation-file", request),''')
path='src/shared/electron-api.d.ts'
files[path]='import type { AnnotationFileRequest, AnnotationFileResult } from "../annotation/document-file";\n'+source(path)
replace(path,'interface MiniCastBridge {','''interface MiniCastBridge {
  annotationFile(request: AnnotationFileRequest): Promise<AnnotationFileResult>;''')
path='src/renderer/components/Controller.tsx'
files[path]='import AnnotationFileControls from "./AnnotationFileControls";\n'+source(path)
replace(path,'            <AnnotationExportControls displays={displays} />','            <AnnotationFileControls displays={displays} />\n            <AnnotationExportControls displays={displays} />')
path='src/electron/testing/smoke.ts'
replace(path,'    Enter: 0x0d,','    Enter: 0x0d,\n    Right: 0x27,')
path='src/electron/testing/interaction-smoke.ts'
files[path]='import { verifyAnnotationFiles } from "./document-file-smoke.js";\n'+source(path)
replace(path,'      }, primary.id);\n    } finally {\n      if (!underlay.isDestroyed())','''      }, primary.id);
      diagnostics.documentFiles = await verifyAnnotationFiles({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand,
        click: async (selector, label) => {
          if (!mainWindow) throw new Error("Missing document-file controller");
          await clickControllerElement(mainWindow, selector, label);
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed())''')
path='scripts/verify-diagnostics.ps1'
replace(path,'  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"','''  foreach ($name in @('nativeSave','nativeOpen','pinnedSave','undoRedo','pixels','cancel','invalidFile','staleOpen','sharedGate','senderRejected','reload')) {
    if (-not $result.diagnostics.documentFiles.$name) { throw "Missing editable-file verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')
path='scripts/verify-source.ps1'
files[path]=source(path)+"\nif (-not $payload.diagnostics.documentFiles.nativeOpen -or -not $payload.diagnostics.documentFiles.undoRedo -or -not $payload.diagnostics.documentFiles.staleOpen) { throw 'Editable file lifecycle was not verified.' }\n"
package=json.loads(source('package.json')); lock=json.loads(source('package-lock.json'))
assert package['version']=='0.12.0'
package['version']=lock['version']=lock['packages']['']['version']='0.13.0'
files['package-lock.json']=json.dumps(lock,ensure_ascii=False,indent=2)+'\n'
path='docs/ANNOTATION-TOOLS.md'
files[path]=source(path)+'''

## 편집 가능한 판서 파일 (0.13.0)

판서 탭의 ‘편집 가능한 판서 파일’에서 대상 화면을 선택하고 ‘판서 파일 저장’ 또는 ‘판서 파일 열기’를 누릅니다. .minicast 파일은 현재 형식 버전 1의 UTF-8 JSON이며, 한 화면의 원래 뷰포트와 확정 객체를 저장합니다. 펜·형광펜·도형·채우기·텍스트 내용과 변형을 다시 편집할 수 있습니다. 임시 표시·UI·배경 화면·Undo/Redo 이력·모니터 ID·설정은 파일에 저장하지 않습니다. 자동 저장이나 앱 시작 시 자동 복원은 하지 않습니다.

저장은 요청 시점의 문서를 고정하고 원자적으로 파일을 교체합니다. 기존 파일 교체 확인은 네이티브 저장 창에서 처리합니다. 저장 또는 열기를 시작하면 클릭 통과로 바뀌고, 작업 중에는 판서 도구로 전환하지 않습니다. PNG 내보내기와 파일 작업의 네이티브 대화상자는 중복되지 않습니다.

열기는 선택한 한 화면의 판서를 교체합니다. 현재 판서가 있으면 취소를 기본값으로 하는 확인 창을 표시하며, 한 번의 실행취소로 이전 판서 전체를 복원합니다. 다른 모니터의 문서는 유지됩니다. 파일 내용이 현재 판서와 같으면 이력과 revision을 변경하지 않습니다. 원래 뷰포트와 대상 화면 크기가 다르면 비율을 유지해 중앙에 맞춥니다. 변환 결과가 좌표·굵기 한도를 넘으면 임의 보정 없이 거부합니다.

64MiB 파일 크기, UTF-8 인코딩, 형식 버전, 필드 목록, 객체 ID 중복, 좌표·스타일, 객체·포인트 총량을 검사합니다. 손상·알 수 없는 버전·잘못된 입력·연결 해제·읽기 실패에는 기존 문서를 변경하지 않습니다. 파일 선택·확인 중 대상 문서가 변경되면 오래된 열기 요청을 거부합니다. 취소 시에도 문서와 Undo/Redo는 그대로 유지됩니다. 승인한 디스크 쓰기가 시작되면 정상 종료는 해당 쓰기의 완료 또는 실패를 기다립니다.

화면 배경 캡처, 모든 모니터를 묶은 세션 파일, 파일 연결을 통한 더블클릭 실행은 이 버전에 포함하지 않습니다. 파일 형식에 이전 버전 변환기나 호환 경로는 두지 않습니다.
'''
path='docs/CHANGELOG.md'
files[path]=source(path)+'''\n\n## 0.13.0\n\n- 한 화면의 편집 가능한 .minicast 판서 파일 저장·열기와 균일 배율 배치.\n- 검증 후 문서 교체, 취소 기본 확인, 한 번의 Undo/Redo, 오래된 열기 요청 거부.\n- PNG 내보내기와 파일 작업의 공통 잠금 및 입력 도구 전환 충돌 방지.\n- UTF-8·파일 크기·현재 스키마·객체 총량 검증과 원자적 파일 저장.\n- 실제 Windows 저장·열기·교체 확인·취소·손상 파일·픽셀 복원 검사.\n'''
path='README.md'
replace(path,'PNG는 이미지이며 다시 편집할 수 있는 판서 파일이 아닙니다. 배경 화면 캡처와 판서 파일 저장·다시 열기는 아직 지원하지 않습니다.',
'''PNG는 이미지이며 다시 편집할 수 있는 판서 파일이 아닙니다. 편집 가능한 객체를 보관하려면 판서 탭의 **판서 파일 저장·열기**에서 `.minicast`를 사용합니다. 열기는 선택한 한 화면만 교체하고 한 번의 Undo로 되돌릴 수 있습니다. 자동 저장과 배경 화면 캡처는 지원하지 않습니다.''')
for path,value in files.items():
    output=Path(path); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(value,encoding='utf-8',newline='\n')
subprocess.run(['git','add','package-lock.json'],check=True)
# Restore the real check command last so incomplete preparation cannot test the old product.
Path('package.json').write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('EDITABLE_FILE_PREPARATION_COMPLETE version=0.13.0; native file dialogs, replacement and exact Undo verification required')
