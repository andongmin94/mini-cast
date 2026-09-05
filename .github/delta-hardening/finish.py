from pathlib import Path
import runpy
runpy.run_path('.github/delta-hardening/apply.py')

def replace(s,a,b,count=1):
    if s.count(a)!=count: raise RuntimeError(f'Expected {count}, got {s.count(a)}: {a[:100]!r}')
    return s.replace(a,b)

p=Path('src/annotation/canvas-renderer.ts')
s=p.read_text()
s=replace(s,'  context.save();\n  context.globalAlpha','  context.save();\n  try {\n  context.globalAlpha')
s=replace(s,'  context.restore();\n}', '  } finally {\n    context.restore();\n  }\n}')
p.write_text(s)

p=Path('src/electron/interaction-smoke.ts')
s=p.read_text()
s='import { verifyDirtyCanvasRendering } from "./rendering-smoke.js";\n'+s
start=s.index('  async function measureAnnotationPipeline(')
end=s.index('  interface SmokeState', start)
part=s[start:end]
part=replace(part,'    if (!target) throw new Error("Missing benchmark renderer");', '''    if (!target) throw new Error("Missing benchmark renderer");
    diagnostics.dirtyCanvasReference = await verifyDirtyCanvasRendering(target.webContents);''')
part=replace(part,'''    await selectTool("pen");
    await waitForOverlayInput(displayId, true);
    const dragStart = performance.now();''','''    await selectTool("pen");
    await waitForOverlayInput(displayId, true);
    // Probe the actual preload/invoke return. Deliberately do not feed this reply
    // to the UI replica, simulating a lost commit acknowledgement. Native Undo
    // must then recover the resulting revision gap from the authoritative source.
    const deltaProbe = await target.webContents.executeJavaScript(`(async () => {
      const entries = [];
      window.__miniCastWireAudit = { entries, stop: miniCast.onAnnotationDocumentUpdated(update => {
        entries.push({ kind: update.kind, bytes: JSON.stringify(update).length,
          inserted: update.kind === 'delta' ? update.inserted.length : null });
      }) };
      const gestureId = crypto.randomUUID();
      miniCast.beginAnnotationGesture(gestureId);
      try {
        const result = await miniCast.commitAnnotationStroke(gestureId, {
          id: crypto.randomUUID(), tool: 'pen', color: '#123456', width: 4, opacity: 1,
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        });
        if (!result.accepted || result.update.kind !== 'delta') throw new Error('Expected an accepted small delta reply');
        return { kind: result.update.kind, replyBytes: JSON.stringify(result).length,
          inserted: result.update.inserted.length, removed: result.update.removedIds.length };
      } finally { miniCast.endAnnotationGesture(gestureId); }
    })()`);
    if (deltaProbe.replyBytes >= 2048 || deltaProbe.inserted !== 1 || deltaProbe.removed !== 0)
      throw new Error("Small edit reply transferred unrelated geometry");
    await shortcutCommand("undo");
    await waitFor(async () => {
      const expected = annotationHistory.getSnapshot(displayId);
      return expected.strokes.length === snapshot.strokes.length && Number(
        await target.webContents.executeJavaScript(
          "document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision"),
      ) === expected.revision;
    }, 10_000, "revision-gap recovery after a lost commit reply");
    diagnostics.deltaTransport = { ...deltaProbe, baselineSnapshotBytes: bytes, gapRecovered: true };
    const dragStart = performance.now();''')
part=replace(part,'    const metrics = {', '''    const wireUpdates = await target.webContents.executeJavaScript(`(() => {
      const audit = window.__miniCastWireAudit;
      audit.stop(); delete window.__miniCastWireAudit; return audit.entries;
    })()`);
    if (wireUpdates.length < 3 || wireUpdates.some((entry: { kind: string }) => entry.kind !== "delta"))
      throw new Error("Normal Undo/Redo edits did not use delta IPC");
    diagnostics.deltaWireUpdates = wireUpdates;
    const metrics = {''')
s=s[:start]+part+s[end:]
p.write_text(s)

p=Path('.github/workflows/verify.yml')
s=p.read_text()
s=replace(s,'if (-not $result.success -or -not $result.diagnostics.heldEraserUndo) {', 'if (-not $result.success -or -not $result.diagnostics.heldEraserUndo -or -not $result.diagnostics.dirtyCanvasReference.success -or -not $result.diagnostics.deltaTransport.gapRecovered) {')
p.write_text(s)

p=Path('README.md')
s=p.read_text()+'''

## 0.3.5 변경분 동기화와 부분 재그리기

- 최초 연결과 화면 재설정에는 전체 snapshot을 전달합니다. 일반 편집 응답과 Undo/Redo 알림은 baseRevision/revision, 삭제 ID, 새로 삽입한 획만 전달합니다. 문서 크기만큼 남아 있는 ID 비교 비용과 변경분 직렬화 비용을 상수 시간이라고 표현하지 않습니다.
- renderer의 한 replica가 이벤트와 IPC 응답을 함께 처리합니다. 중복·오래된 변경은 무시하고 revision이 끊겼을 때만 전체 문서를 재요청합니다. 동시 복구 요청은 합치며 이전 화면 세대의 늦은 응답은 버립니다.
- 삭제·Undo는 영향받은 영역을 물리 픽셀 경계에 맞춰 지우고, 겹치는 모든 획을 기존 합성 순서로 다시 그립니다. DPR/viewport 변경에는 전체 재그리기를 사용합니다. 지우는 영역이 화면 대부분이면 부분 재그리기의 이득도 줄어듭니다.
- Windows 검증은 실제 IPC 응답 크기, 일부러 누락시킨 커밋 응답 뒤의 복구, 정상 명령의 delta 전송을 검사합니다. 실제 Chromium Canvas에서 DPR 1/1.25/1.5/2/2.5의 부분 결과를 전체 재그리기와 모든 RGBA 바이트로 비교합니다. 물리 GPU·장시간 강의의 성능 보증은 아닙니다.
'''
p.write_text(s)
print('Prepared native delta-reply/gap recovery and exact Chromium pixel comparisons.')
