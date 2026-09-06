"""Apply the reviewed presentation-board increment; removed by verification."""
from pathlib import Path
import json
import subprocess

BASE = '6118f30ff7082d1d0ea09f6ca36f3732bf94f807'
MODULES = '58400a2ad919b3b898c3f6bd63f89ec6b319083a'
guard = json.loads(Path('package.json').read_text(encoding='utf-8'))
guard['scripts']['check'] = 'node -e "throw new Error(\'Board preparation incomplete\')"'
Path('package.json').write_text(json.dumps(guard, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
subprocess.run(['git','fetch','--depth=1','origin',BASE],check=True)
subprocess.run(['git','diff','--exit-code',BASE,'HEAD','--','.',':!.github/reorganize.py'],check=True)
subprocess.run(['git','fetch','--depth=1','origin',MODULES],check=True)
NEW_FILES = ['src/annotation/board.ts','src/renderer/components/AnnotationBoardControls.tsx',
             'src/electron/testing/board-smoke.ts','tests/unit/annotation/board.test.mjs']
files = {}
for name in NEW_FILES:
    if Path(name).exists(): raise RuntimeError('Board file already exists: '+name)
    files[name] = subprocess.check_output(['git','show',MODULES+':'+name]).decode('utf-8')
def source(path): return subprocess.check_output(['git','show',BASE+':'+path]).decode('utf-8')
def replace(path,old,new,count=1):
    value=files[path] if path in files else source(path)
    if value.count(old)!=count: raise RuntimeError(f'{path}: expected {count} targets, found {value.count(old)}: {old[:80]!r}')
    files[path]=value.replace(old,new)

path='src/electron/main.ts'
files[path]='import { AnnotationBoards, readAnnotationBoardRequest, type AnnotationBoardResult } from "../annotation/board.js";\n'+source(path)
replace(path,'const annotationHistory = new AnnotationHistory();','const annotationHistory = new AnnotationHistory();\nconst annotationBoards = new AnnotationBoards();')
replace(path,'function getAnnotationState(): AnnotationState {','''function sendAnnotationBoards() {
  const state = annotationBoards.snapshot;
  sendToWindow(mainWindow, "annotation-boards-updated", state);
  overlayWindows.forEach(window => sendToWindow(window, "annotation-boards-updated", state));
}

function getAnnotationState(): AnnotationState {''')
replace(path,'    document: snapshot,\n  });\n}\n\nfunction registerIpc()',
  '    document: snapshot,\n  });\n  sendToWebContents(event.sender, "annotation-boards-updated", annotationBoards.snapshot);\n}\n\nfunction registerIpc()')
replace(path,'function registerIpc() {','''function registerIpc() {
  ipcMain.handle("get-annotation-boards", event => {
    if (!isControllerEvent(event)) throw new Error("Invalid board-state request");
    return annotationBoards.snapshot;
  });
  ipcMain.handle("set-annotation-board", (event, value: unknown): AnnotationBoardResult => {
    if (!isControllerEvent(event) || !mainWindow?.isVisible())
      return { accepted: false, reason: "invalid-request" };
    const request = readAnnotationBoardRequest(value);
    if (!request) return { accepted: false, reason: "invalid-request" };
    if (annotationIo.busy) return { accepted: false, reason: "busy" };
    if (shuttingDown || displayRebuildInProgress || controllerTextEditing || textEdits.current ||
        !annotationBoards.has(request.displayId)) return { accepted: false, reason: "unavailable" };
    const changed = annotationBoards.set(request.displayId, request.mode);
    if (changed) {
      cancelActiveAnnotationGestures();
      overlayWindows.forEach((window, index) => {
        if (overlayDisplays[index]?.id === request.displayId) sendToWindow(window, "annotation-transient-clear");
      });
    }
    if (annotationTool === "pass-through") setAnnotationTool("pen");
    sendAnnotationBoards();
    return { accepted: true, changed, state: annotationBoards.snapshot };
  });''')
replace(path,'    annotationHistory.retainDisplays(connectedIds);','    annotationHistory.retainDisplays(connectedIds);\n    annotationBoards.retainDisplays(connectedIds);\n    sendAnnotationBoards();')

replace('src/electron/preload.cts','contextBridge.exposeInMainWorld("miniCast", {','''contextBridge.exposeInMainWorld("miniCast", {
  getAnnotationBoards: () => ipcRenderer.invoke("get-annotation-boards"),
  setAnnotationBoard: (request: unknown) => ipcRenderer.invoke("set-annotation-board", request),
  onAnnotationBoardsUpdated: (listener: Listener) => on("annotation-boards-updated", listener),''')
path='src/shared/electron-api.d.ts'
files[path]='import type { AnnotationBoardRequest, AnnotationBoardSnapshot, AnnotationBoardResult } from "../annotation/board";\n'+source(path)
replace(path,'interface MiniCastBridge {','''interface MiniCastBridge {
  getAnnotationBoards(): Promise<AnnotationBoardSnapshot>;
  setAnnotationBoard(request: AnnotationBoardRequest): Promise<AnnotationBoardResult>;
  onAnnotationBoardsUpdated(listener: (state: AnnotationBoardSnapshot) => void): Unsubscribe;''')
path='src/renderer/components/Controller.tsx'
files[path]='import AnnotationBoardControls from "./AnnotationBoardControls";\n'+source(path)
replace(path,'            <AnnotationFileControls displays={displays} />','            <AnnotationBoardControls displays={displays} />\n            <AnnotationFileControls displays={displays} />')
path='src/renderer/components/Overlay.tsx'
files[path]='import { annotationBoardBackground, newerAnnotationBoards, type AnnotationBoardSnapshot } from "@/annotation/board";\n'+source(path)
replace(path,'export default function Overlay() {','export default function Overlay() {\n  const [boards, setBoards] = useState<AnnotationBoardSnapshot | null>(null);')
replace(path,'      miniCast.onAnnotationStateUpdated(setAnnotationState),','      miniCast.onAnnotationStateUpdated(setAnnotationState),\n      miniCast.onAnnotationBoardsUpdated(next => setBoards(current => newerAnnotationBoards(current, next))),')
replace(path,'  const passive = annotationState.tool === "pass-through";','  const passive = annotationState.tool === "pass-through";\n  const boardMode = boards?.displays.find(display => display.displayId === displayId)?.mode ?? "transparent";')
replace(path,'        // A zero-alpha layered window can miss native pointer input on Windows.\n        // One alpha step keeps blank areas hit-testable without painting the document.\n        backgroundColor: passive ? "transparent" : "rgba(0, 0, 0, 0.004)",','        // Presentation backgrounds never enter the document Canvas or intercept passive clicks.\n        backgroundColor: annotationBoardBackground(boardMode, !passive),')
replace(path,'      data-mini-cast-overlay=""','      data-mini-cast-overlay=""\n      data-board-mode={boardMode}')
path='src/electron/testing/interaction-smoke.ts'
files[path]='import { verifyAnnotationBoards } from "./board-smoke.js";\n'+source(path)
old='      }, primary.id);\n    } finally {\n      if (!underlay.isDestroyed()) underlay.destroy();'
new=r'''      }, primary.id);
      diagnostics.boardTools = await verifyAnnotationBoards({
        history: annotationHistory, state: context.state, publishDocument: context.publishDocument,
        refreshDisplays: context.refreshDisplays,
        click: async (selector, description) => {
          if (!mainWindow) throw new Error("Missing board controller");
          await clickControllerElement(mainWindow, selector, description);
        },
        checkPassThrough: async () => {
          await waitForOverlayInput(primary.id, false);
          // Native dialogs can change foreground order. Re-establish the witness
          // window, but never alter production overlay input flags to make a test pass.
          if (underlay.isDestroyed()) throw new Error("Board input witness was destroyed");
          underlay.show();
          underlay.focus();
          const witness = underlay.getContentBounds();
          const point = { x: witness.x + Math.round(witness.width / 2), y: witness.y + Math.round(witness.height / 2) };
          const previousTitle = await underlay.webContents.executeJavaScript("document.title") as string;
          const match = /^click-(\d+)$/.exec(previousTitle);
          if (!match) throw new Error(`Invalid board witness counter: ${previousTitle}`);
          const expectedTitle = `click-${Number(match[1]) + 1}`;
          await injectWindowsClick(point.x, point.y);
          try {
            await waitFor(async () => await underlay.webContents.executeJavaScript("document.title") === expectedTitle,
              5000, "board Escape restores native underlay clicks");
          } catch (error) {
            console.error("BOARD_CLICK_ROUTING", JSON.stringify({ point, expectedTitle,
              observedTitle: await underlay.webContents.executeJavaScript("document.title"),
              witness: { bounds: witness, visible: underlay.isVisible(), focused: underlay.isFocused() },
              controller: mainWindow ? { bounds: mainWindow.getBounds(), topmost: mainWindow.isAlwaysOnTop(), visible: mainWindow.isVisible() } : null,
              state: context.state(), cursor: screen.getCursorScreenPoint(),
            }));
            throw error;
          }
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();'''
replace(path,old,new)
path='src/electron/testing/export-smoke.ts'
replace(path,'  if(overlapping.reason!=="busy") throw new Error("A second export replaced an open native dialog");',
  '  if(overlapping.reason!=="busy") throw new Error("A second export replaced an open native dialog");\n  const boardChange = await controller.webContents.executeJavaScript(`miniCast.setAnnotationBoard({displayId:${displayId},mode:"black"})`);\n  if (boardChange.accepted || boardChange.reason !== "busy") throw new Error("Board changed during native export");')
path='scripts/verify-source.ps1'
files[path]=source(path)+"\nif (-not $payload.diagnostics.boardTools.composedPixels -or -not $payload.diagnostics.boardTools.pngTransparent -or -not $payload.diagnostics.boardTools.escapeRouting) { throw 'Board presentation/input isolation was not verified.' }\n"
path='scripts/verify-diagnostics.ps1'
replace(path,'  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"','''  foreach ($name in @('white','black','composedPixels','cancelledInput','historyIsolated','fileIsolated','pngTransparent','senderRejected','noOp','escapeRouting','reentry','controllerReload','overlayReload','displayRebuild')) {
    if (-not $result.diagnostics.boardTools.$name) { throw "Missing presentation-board verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')

package=json.loads(source('package.json'))
lock=json.loads(source('package-lock.json'))
assert package['version']=='0.13.0'
package['version']=lock['version']=lock['packages']['']['version']='0.14.0'
files['package.json']=json.dumps(package,ensure_ascii=False,indent=2)+'\n'
files['package-lock.json']=json.dumps(lock,ensure_ascii=False,indent=2)+'\n'
path='docs/ANNOTATION-TOOLS.md'
files[path]=source(path).replace('현재 문서 기준은 0.13.0입니다.','현재 문서 기준은 0.14.0입니다.')+'''

## 화이트보드·블랙보드 (0.14.0)

판서 탭의 ‘판서 배경’에서 대상 화면을 고른 뒤 ‘화면 판서’, ‘화이트보드’, ‘블랙보드’를 누릅니다. 선택한 모니터의 배경만 바꾸고 기존 객체·겹침 순서·Undo/Redo는 보존합니다. 조작 모드에서 누르면 펜 모드로 들어가며, 이미 판서 중이면 현재 도구를 유지합니다.

배경은 문서가 아니라 발표용 세션 표시입니다. Escape·조작 모드·컨트롤러 숨김에서는 배경을 숨겨 아래 프로그램을 보면서 클릭할 수 있게 합니다. 같은 세션에서 판서 도구로 돌아오면 선택한 배경이 다시 나타납니다. 일반 판서는 이전과 같이 남습니다. renderer 재로딩·오버레이 재생성에서는 배경 선택을 복원하며, 모니터 연결 해제와 앱 종료에서는 해당 선택을 폐기합니다.

배경 변경은 실행취소 이력을 만들지 않으며 진행 중 입력만 취소합니다. 이미 확정된 객체와 파일 저장 내용은 변하지 않습니다. 펜·텍스트·윤곽선 색상은 자동으로 바꾸지 않으므로 배경과 구분되는 색을 고르세요. PNG·클립보드는 계속 투명한 판서 이미지를 만들고, `.minicast` 파일에는 배경을 넣지 않습니다. 다른 파일을 열어도 현재 발표 배경은 유지합니다.

네이티브 파일·이미지 작업 또는 텍스트 편집 중에는 배경 변경을 거부하고 안내합니다. 지연된 초기 상태 응답이 더 새로운 배경 선택을 덮지 않도록 별도 상태 revision을 사용합니다. 보드별 별도 페이지나 무한 캔버스 기능은 포함하지 않습니다.
'''
path='README.md'
replace(path,'- 펜 · 형광펜 · 요소 지우개','- 펜 · 형광펜 · 요소 지우개\n- 모니터별 화이트보드·블랙보드 배경 전환 (판서·Undo 유지, Escape로 배경 숨김)')
path='docs/CHANGELOG.md'
files[path]=source(path)+'''

## 0.14.0

- 모니터별 화이트보드·블랙보드·화면 판서 배경 전환.
- Escape와 조작 모드에서 배경 숨김, 재진입·renderer 재로딩·오버레이 재생성 시 세션 선택 복원.
- 배경과 문서·Undo/Redo·파일·투명 PNG를 분리하고 진행 중 입력을 안전하게 취소.
- 배경 스냅샷 순서·연결 해제 회귀 검사 및 실제 Windows 입력·합성 픽셀·클립보드 검사.
'''
for name,value in files.items():
    file=Path(name)
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(value,encoding='utf-8',newline='\n')
subprocess.run(['git','add','package-lock.json'],check=True)
print('BOARD_PREPARATION_COMPLETE version=0.14.0; native input, composition, file and PNG isolation checks required')
