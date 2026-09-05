"""Refine temporary-tool lifecycle and verify real click routing without changing triggers.
All existing native-input, Canvas, package, install/removal and ZIP gates remain required.
The historical opt-in runner removes this preparation file after successful verification.
"""
from pathlib import Path
import json
import subprocess

# Fail closed even if the historical PowerShell step ignores the first Python exit.
guard=json.loads(Path('package.json').read_text(encoding='utf-8'))
guard['scripts']['check']='node -e "throw new Error(\'Transient refinement incomplete\')"'
Path('package.json').write_text(json.dumps(guard,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
BASE='e1cf71d42cbe022fb8c365efec7a838fea80156c'
subprocess.run(['git','fetch','--depth=1','origin',BASE],check=True)
subprocess.run(['git','diff','--exit-code',BASE,'HEAD','--','.',':!.github/reorganize.py'],check=True)
def source(path): return subprocess.check_output(['git','show',BASE+':'+path]).decode('utf-8')
def write(path,value): Path(path).write_text(value,encoding='utf-8',newline='\n')
package=json.loads(source('package.json'))
assert package['version']=='0.11.0'
files={}
def replace(path,old,new,count=1):
    value=files.get(path,source(path))
    if value.count(old)!=count: raise RuntimeError(f'{path}: expected {count} matches for {old[:80]!r}, got {value.count(old)}')
    files[path]=value.replace(old,new)

surface='src/renderer/components/AnnotationTransientSurface.tsx'
replace(surface,'    const surface = canvas.current!;\n    const resize = () => {','    const surface = canvas.current!;\n    const model = ink.current;\n    let viewport = "";\n    const resize = () => {')
replace(surface,'      alive.current = false;\n      detach();\n      ink.current.clear();','      alive.current = false;\n      detach();\n      model.clear();')
replace(surface,'      if (surface.width === w && surface.height === h) return;\n      clear();','''      const nextViewport = `${surface.clientWidth}:${surface.clientHeight}:${ratio}`;
      // CSS size and DPI can change while the physical backing-store size stays equal.
      if (viewport === nextViewport) return;
      viewport = nextViewport;
      clear();''')
replace(surface,'''        if (!point) { cursor.current = null; if (active.current) cancel(); }
        else if (tool === "laser") cursor.current = point;
        if (tool === "laser" || !point) requestPaint();''','''        if (!point) {
          const visibleCursor = cursor.current !== null;
          cursor.current = null;
          if (active.current) cancel();
          else if (visibleCursor && tool === "laser") requestPaint();
          return;
        }
        if (tool === "laser") {
          const previous = cursor.current;
          cursor.current = point;
          if (!previous || previous.x !== point.x || previous.y !== point.y) requestPaint();
        }''')
replace('src/electron/main.ts','    lastAnnotationDisplayId = displayId;\n    const previous = gestureLeases.begin','    if (!isTransientAnnotationTool(annotationTool)) lastAnnotationDisplayId = displayId;\n    const previous = gestureLeases.begin')
replace('src/renderer/components/AnnotationControls.tsx','      <div className="grid grid-cols-5 gap-2">','      <div className="grid grid-cols-4 gap-2">')

smoke='src/electron/testing/transient-smoke.ts'
replace(smoke,'  command(command: AnnotationCommand): Promise<void>;','  command(command: AnnotationCommand): Promise<void>;\n  checkClickRouting(blocked: boolean): Promise<void>;')
replace(smoke,'  await query(`window.__temporaryBaseline = document.querySelector(\'canvas\').getContext(\'2d\').getImageData(0,0,document.querySelector(\'canvas\').width,document.querySelector(\'canvas\').height).data`);','''  await query(`(() => { const c=document.querySelector('canvas');
    window.__temporaryBaseline=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return true; })()`);
  await context.checkClickRouting(true);''')
replace(smoke,'  await waitFor(noTransientInk,3000,"temporary pixels expire completely");','''  await waitFor(async () => await noTransientInk() && await query(
    `document.querySelector('[data-annotation-transient]')?.dataset.transientPoints === '0'`),
    3000,"temporary pixels and retained points expire completely");''')
replace(smoke,'  await draw();\n  const loaded=new Promise<void>', '''  // Real Chromium zoom changes CSS coordinates and DPR together; not a physical-monitor test.
  await draw();
  const viewport = await query(`(() => {const c=document.querySelector('[data-annotation-transient]');
    return {width:c.width,height:c.height,cssWidth:c.clientWidth,ratio:window.devicePixelRatio};})()`);
  const zoom = overlay.webContents.getZoomFactor();
  try {
    overlay.webContents.setZoomFactor(zoom * 2);
    await waitFor(async () => await query(
      `document.querySelector('[data-annotation-transient]').clientWidth`) !== viewport.cssWidth,
      2000,"Chromium zoom changes temporary CSS coordinates");
    await waitFor(async () => await noTransientInk() && await query(
      `document.querySelector('[data-annotation-transient]')?.dataset.transientPoints === '0'`),
      2000,"CSS/DPI change discards temporary coordinates");
    const resized = await query(`(() => {const c=document.querySelector('[data-annotation-transient]');
      return {width:c.width,height:c.height,ratio:window.devicePixelRatio};})()`);
    assert.equal(resized.width,viewport.width); assert.equal(resized.height,viewport.height);
    assert.notEqual(resized.ratio,viewport.ratio); unchanged();
  } finally {
    overlay.webContents.setZoomFactor(zoom);
    await waitFor(async () => await query(
      `document.querySelector('[data-annotation-transient]').clientWidth`) === viewport.cssWidth,
      2000,"restore original Chromium zoom");
  }
  await draw();
  const loaded=new Promise<void>''')
replace(smoke,'  await choose("laser"); const p=at(320,240);','  await choose("laser"); await context.checkClickRouting(true); const p=at(320,240);')
replace(smoke,'  await choose("pen"); assert.equal(context.state().canRedo,true);','  await context.checkClickRouting(false); unchanged();\n  await choose("pen"); assert.equal(context.state().canRedo,true);')
replace(smoke,'    heldUndo:true, heldEscape:true, reload:true, permanentWritesRejected:true, redoPreserved:true };','    heldUndo:true, heldEscape:true, reload:true, permanentWritesRejected:true, redoPreserved:true, viewportReset:true, clickRouting:true };')
replace('src/electron/testing/interaction-smoke.ts','''            const canvases = document.querySelectorAll("canvas");
            return canvases.length > 1
              ? getComputedStyle(canvases[1]).pointerEvents
              : "missing";''','''            const canvases = [...document.querySelectorAll("canvas")];
            if (!canvases.length) return "missing";
            return canvases.some(canvas => getComputedStyle(canvas).pointerEvents === "auto")
              ? "auto" : "none";''')
replace('src/electron/testing/interaction-smoke.ts','''        history: annotationHistory, state: context.state, publishDocument: context.publishDocument, command: shortcutCommand,
        activateTool: async tool => {''','''        history: annotationHistory, state: context.state, publishDocument: context.publishDocument, command: shortcutCommand,
        checkClickRouting: async blocked => {
          await waitForOverlayInput(primary.id, blocked);
          const before = clickCount;
          await injectWindowsClick(start.x, start.y);
          if (blocked) {
            const title = await underlay.webContents.executeJavaScript("document.title");
            if (title !== `click-${before}`) throw new Error("Temporary tool leaked a pointerdown to the underlay");
          } else {
            await waitFor(() => clickCount === before + 1, 5000, "post-transient Escape actually restores underlay clicks");
          }
        },
        activateTool: async tool => {''')
replace('scripts/verify-diagnostics.ps1',"'permanentWritesRejected','redoPreserved'","'permanentWritesRejected','redoPreserved','viewportReset','clickRouting'")
files['scripts/verify-source.ps1']=source('scripts/verify-source.ps1')+"\nif (-not $payload.diagnostics.transientTools.viewportReset -or -not $payload.diagnostics.transientTools.clickRouting) { throw 'Temporary viewport/routing boundary was not verified.' }\n"
files['docs/CHANGELOG.md']=source('docs/CHANGELOG.md')+'\n- 실제 Chromium 배율 변경과 실제 클릭 차단·Escape 후 복귀를 검증합니다. 포인터가 없는 화면의 빈 임시 레이어는 반복해서 다시 그리지 않습니다. 물리 모니터 DPI 검증은 아닙니다.\n- 임시 표시 효과의 정리 대상을 고정하고 ESLint 경고도 검증 실패로 처리합니다.\n'
package['scripts']['lint']='eslint . --max-warnings 0'
for name,content in files.items(): write(name,content)
write('package.json',json.dumps(package,ensure_ascii=False,indent=2)+'\n')
print('TRANSIENT_REFINEMENT_COMPLETE version=0.11.0; warning-free lint, native routing and Chromium zoom diagnostics mandatory')
