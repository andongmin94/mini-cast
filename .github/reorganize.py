"""Apply reviewed PNG export and validate before publishing product changes.
This one-run file is removed by the existing opt-in Windows job.
"""
from pathlib import Path
import json
import subprocess

BASE = '2acf65e4be846810b475509968fe9d088ff2ccc4'
MODULES = 'de4abd676d3722e8e2fd8f6d41d626229e401606'
guard = json.loads(Path('package.json').read_text(encoding='utf-8'))
guard['scripts']['check'] = 'node -e "throw new Error(\'PNG export preparation incomplete\')"'
Path('package.json').write_text(json.dumps(guard, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
subprocess.run(['git','fetch','--depth=1','origin',BASE],check=True)
subprocess.run(['git','diff','--exit-code',BASE,'HEAD','--','.',':!.github/reorganize.py'],check=True)
subprocess.run(['git','fetch','--depth=1','origin',MODULES],check=True)
def source(path): return subprocess.check_output(['git','show',BASE+':'+path]).decode('utf-8')
def write(path,value):
    file=Path(path)
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(value,encoding='utf-8',newline='\n')
files={}
def replace(path,old,new,count=1):
    value=files.get(path,source(path))
    if value.count(old)!=count: raise RuntimeError(f'{path}: expected {count} targets, found {value.count(old)}: {old[:100]!r}')
    files[path]=value.replace(old,new)

new_files = [
 'src/annotation/export.ts','src/annotation/export-renderer.ts',
 'src/electron/annotation-export.ts','src/electron/export-render-session.ts','src/electron/png-file.ts',
 'src/renderer/lib/annotation-export.ts','src/renderer/components/AnnotationExportControls.tsx',
 'src/electron/testing/export-smoke.ts','src/electron/testing/export-rendering-smoke.ts',
 'tests/unit/annotation/export.test.mjs','tests/unit/electron/export-render-session.test.mjs','tests/unit/electron/png-file.test.mjs',
]
for path in new_files:
    if Path(path).exists(): raise RuntimeError('Export file already exists: '+path)
    files[path]=subprocess.check_output(['git','show',MODULES+':'+path]).decode('utf-8')
replace('src/electron/main.ts','import { randomUUID }','import { registerAnnotationExports } from "./annotation-export.js";\nimport { randomUUID }')
replace('src/electron/main.ts','function registerIpc() {','''function registerIpc() {
  registerAnnotationExports({
    history: annotationHistory,
    unavailable: () => shuttingDown || displayRebuildInProgress || controllerTextEditing || Boolean(textEdits.current),
    prepareFileDialog: () => setAnnotationTool("pass-through"),
  });''')
replace('src/electron/preload.cts','contextBridge.exposeInMainWorld("miniCast", {','''contextBridge.exposeInMainWorld("miniCast", {
  exportAnnotation: (request: unknown) => ipcRenderer.invoke("annotation-export", request),
  onAnnotationExportRender: (listener: Listener) => on("annotation-export-render", listener),
  completeAnnotationExport: (id: unknown, bytes: unknown) => ipcRenderer.send("annotation-export-rendered", id, bytes),''')
path='src/shared/electron-api.d.ts'
files[path]='import type { AnnotationExportRequest, AnnotationExportResult, AnnotationExportRenderRequest } from "../annotation/export";\n'+source(path)
replace(path,'interface MiniCastBridge {','''interface MiniCastBridge {
  exportAnnotation(request: AnnotationExportRequest): Promise<AnnotationExportResult>;
  onAnnotationExportRender(listener: (request: AnnotationExportRenderRequest) => void): Unsubscribe;
  completeAnnotationExport(id: string, bytes: Uint8Array | null): void;''')
path='src/renderer/components/Overlay.tsx'
files[path]='import { listenForAnnotationExports } from "@/renderer/lib/annotation-export";\n'+source(path)
replace(path,'    const unsubscribe = [','    const unsubscribe = [\n      listenForAnnotationExports(() => displayIdRef.current),')
path='src/renderer/components/Controller.tsx'
files[path]='import AnnotationExportControls from "./AnnotationExportControls";\n'+source(path)
replace(path,'              canRedo={annotationState.canRedo}\n            />','              canRedo={annotationState.canRedo}\n            />\n            <AnnotationExportControls displays={displays} />')
path='src/electron/testing/interaction-smoke.ts'
files[path]='import { verifyAnnotationExports } from "./export-smoke.js";\n'+source(path)
replace(path,'      }, primary.id);\n    } finally {\n      if (!underlay.isDestroyed())','''      }, primary.id);
      diagnostics.exportTools = await verifyAnnotationExports({
        history: annotationHistory, publishDocument: context.publishDocument,
        click: async (selector, description) => {
          if (!mainWindow) throw new Error("Missing PNG-export controller");
          await clickControllerElement(mainWindow, selector, description);
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed())''')
path='scripts/verify-diagnostics.ps1'
replace(path,'  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"','''  foreach ($name in @('clipboard','transparent','pngFile','nativeDialog','cancel','pinnedRevision','historyIsolated','busy','senderRejected','emptyPreservesClipboard')) {
    if (-not $result.diagnostics.exportTools.$name) { throw "Missing PNG export verification: $name" }
  }
  if ($result.diagnostics.exportTools.rendering.comparisons -ne 5) { throw 'PNG scale coverage was not executed.' }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')
path='scripts/verify-source.ps1'
files[path]=source(path)+"\nif (-not $payload.diagnostics.exportTools.pngFile -or -not $payload.diagnostics.exportTools.clipboard -or -not $payload.diagnostics.exportTools.pinnedRevision) { throw 'PNG/clipboard export was not verified.' }\n"

package=json.loads(source('package.json'))
assert package['version']=='0.11.0'
lock=json.loads(source('package-lock.json'))
writer=lock['packages']['node_modules/atomically']
assert isinstance(writer['version'],str) and not writer.get('dev',False)
package['dependencies']['atomically']=writer['version']
lock['packages']['']['dependencies']['atomically']=writer['version']
package['version']=lock['version']=lock['packages']['']['version']='0.12.0'
files['package.json']=json.dumps(package,ensure_ascii=False,indent=2)+'\n'
files['package-lock.json']=json.dumps(lock,ensure_ascii=False,indent=2)+'\n'
path='docs/ANNOTATION-TOOLS.md'
files[path]=source(path).replace('캡처 및 판서 파일 저장은 아직 지원하지 않습니다.','배경 화면 캡처 및 편집 가능한 판서 파일 저장은 아직 지원하지 않습니다.')+'''

## 투명 PNG 저장·클립보드 복사 (0.12.0)

판서 탭의 ‘판서 이미지 내보내기’에서 대상 모니터를 선택하고 ‘PNG 저장’ 또는 ‘이미지 복사’를 누릅니다. 화면 전체 크기에 맞는 투명 PNG이며, 해당 물리 모니터의 배율을 사용합니다. Chromium 확대율과는 독립적입니다. 한 변 8,192px, 총 16,777,216픽셀을 넘으면 오류를 안내하고 임의 축소하지 않습니다.

요청 시점의 확정 문서를 별도 Canvas에서 원래 순서로 그립니다. 배경 화면·컨트롤러·선택 테두리·진행 중 미리보기·레이저·사라지는 잉크는 포함하지 않습니다. 저장 중 문서가 변경돼도 이미 요청한 이미지에는 섞이지 않습니다. 내보내기는 문서·Undo/Redo를 수정하지 않습니다.

PNG 저장은 조작 모드로 전환하고 네이티브 저장 창을 엽니다. 취소해도 문서와 기존 파일은 유지됩니다. 파일 이름은 .png 확장자를 사용합니다. 기록은 기존 원자적 파일 저장 라이브러리를 사용하며, 승인된 쓰기가 시작된 후에는 완료하도록 둡니다. 이미지 복사는 시스템 이미지 클립보드를 대체하며 붙여넣는 프로그램의 투명 배경 지원 여부에 따라 표현이 달라질 수 있습니다.

빈 문서·연결 해제·텍스트 편집 중 요청·중복 요청·렌더링 실패는 별도 안내합니다. renderer에는 파일 경로나 범용 클립보드 API를 노출하지 않습니다. PNG 응답은 요청한 창·일회용 토큰·해상도·용량을 검사한 뒤 네이티브 디코더로 확인합니다. 텍스트 폰트 로드를 기다리며, 창 재로딩과 15초 렌더링 제한을 처리합니다. 저장 대화상자에서 사용자가 선택하는 시간에는 자동 취소 제한을 두지 않습니다.

PNG는 래스터 이미지입니다. 판서 파일 다시 열기·객체 편집 데이터 저장·배경 화면 캡처 기능은 이 작업에 포함하지 않습니다.
'''
path='docs/CHANGELOG.md'
files[path]=source(path)+"\n\n## 0.12.0\n\n- 명시적 모니터 선택과 물리 해상도의 투명 PNG 저장·이미지 클립보드 복사.\n- 확정 문서 snapshot만 내보내며 임시 입력·도구 UI·배경 화면과 분리.\n- 크기 제한, 발신 창·토큰 검증, 렌더링 시간 제한, 원자적 파일 저장.\n- 실제 네이티브 저장 대화상자·취소·클립보드·동시 편집 격리 검사 추가.\n"
for path,value in files.items(): write(path,value)
subprocess.run(['git','add','package-lock.json'],check=True)
print('PNG_EXPORT_PREPARATION_COMPLETE version=0.12.0; native Save dialog, clipboard and pixel checks mandatory')
