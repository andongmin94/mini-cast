from pathlib import Path
import json


def replace(text, before, after, count=1):
    actual = text.count(before)
    if actual != count:
        raise RuntimeError(f'Expected {count} occurrences, got {actual}: {before[:120]!r}')
    return text.replace(before, after)


path = Path('src/annotation/history.ts')
s = path.read_text(encoding='utf-8')
for interface in ['AnnotationPoint', 'AnnotationStroke', 'AnnotationViewport', 'AnnotationDocumentSnapshot']:
    start = s.index(f'export interface {interface} {{')
    end = s.index('\n}', start)
    part = s[start:end]
    lines = part.splitlines()
    lines = [lines[0]] + [('  readonly ' + line[2:]) if line.startswith('  ') else line for line in lines[1:]]
    s = s[:start] + '\n'.join(lines) + s[end:]
start = s.index('function clonePoint(')
end = s.index('\nfunction scaleStroke(', start)
s = s[:start] + '''/** Copy untrusted input exactly once, then share only deeply immutable geometry. */
function immutableStroke(stroke: AnnotationStroke): AnnotationStroke {
  return Object.freeze({
    id: stroke.id,
    tool: stroke.tool,
    points: Object.freeze(stroke.points.map(({ x, y }) => Object.freeze({ x, y }))),
    color: stroke.color,
    width: stroke.width,
    opacity: stroke.opacity,
  });
}
''' + s[end:]
s = replace(s, '''  return {
    ...cloneAnnotationStroke(stroke),
    points: stroke.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
    width: Math.min(128, Math.max(0.5, stroke.width * widthScale)),
  };''', '''  return Object.freeze({
    ...stroke,
    points: Object.freeze(stroke.points.map((point) => Object.freeze({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }))),
    width: Math.min(128, Math.max(0.5, stroke.width * widthScale)),
  });''')
s = replace(s, 'return { ...entry, stroke: cloneAnnotationStroke(entry.stroke) };', 'return { ...entry };')
s = replace(s, 'stroke: cloneAnnotationStroke(stroke),', 'stroke,')
s = replace(s, '  private revisions = new Map<number, number>();', '''  private revisions = new Map<number, number>();
  private snapshots = new Map<number, AnnotationDocumentSnapshot>();''')
s = replace(s, '''  restoreFrom(source: AnnotationHistory) {
    this.documents = new Map(''', '''  restoreFrom(source: AnnotationHistory) {
    if (source === this) return;
    this.snapshots.clear();
    this.documents = new Map(''')
s = replace(s, 'strokes: document.strokes.map(cloneAnnotationStroke),', 'strokes: document.strokes.slice(),', count=2)
start = s.index('  getSnapshot(displayId: number): AnnotationDocumentSnapshot {')
end = s.index('\n  retainDisplays(', start)
s = s[:start] + '''  /** Stable for this revision. Never mutate a returned snapshot or its geometry. */
  getSnapshot(displayId: number): AnnotationDocumentSnapshot {
    const cached = this.snapshots.get(displayId);
    if (cached) return cached;
    const document = this.document(displayId);
    const snapshot: AnnotationDocumentSnapshot = Object.freeze({
      displayId,
      revision: this.revisions.get(displayId) ?? 0,
      viewport: document.viewport ? Object.freeze({ ...document.viewport }) : null,
      strokes: Object.freeze(document.strokes.slice()),
    });
    this.snapshots.set(displayId, snapshot);
    return snapshot;
  }
''' + s[end:]
s = replace(s, '      this.revisions.delete(displayId);', '      this.revisions.delete(displayId);\n      this.snapshots.delete(displayId);')
s = replace(s, 'const stored = cloneAnnotationStroke(stroke);', 'const stored = immutableStroke(stroke);')
s = replace(s, 'removed.push({ stroke: cloneAnnotationStroke(stroke), index });', 'removed.push({ stroke, index });')
s = replace(s, '        cloneAnnotationStroke(entry.stroke),', '        entry.stroke,')
s = replace(s, '        cloneAnnotationStroke(stroke),', '        stroke,')
s = replace(s, '''  private touch(displayId: number) {
    this.revisions.set''', '''  private touch(displayId: number) {
    this.snapshots.delete(displayId);
    this.revisions.set''')
assert 'cloneAnnotationStroke' not in s
path.write_text(s, encoding='utf-8')

path = Path('tests/annotation-history.test.mjs')
s = path.read_text(encoding='utf-8')
s = replace(s, '  snapshot.strokes[0].points[0].x = 777;', '''  assert.throws(() => { snapshot.strokes[0].points[0].x = 777; }, TypeError);''')
path.write_text(s, encoding='utf-8')

path = Path('src/annotation/geometry.ts')
s = path.read_text(encoding='utf-8')
s = replace(s, 'function segmentToSegmentDistanceSquared(', 'export function segmentToSegmentDistanceSquared(')
path.write_text(s, encoding='utf-8')

path = Path('src/components/AnnotationSurface.tsx')
s = path.read_text(encoding='utf-8')
s = replace(s, 'import { eraserSweepHitsStroke, pointHitsStroke } from "@/annotation/geometry";', '''import {
  prepareEraserStroke,
  eraserSweepHitsPreparedStroke,
  type PreparedEraserStroke,
} from "@/annotation/eraser-index";''')
s = replace(s, 'const eraserBaseRef = useRef<readonly AnnotationStroke[] | null>(null);', '''const eraserBaseRef = useRef<readonly PreparedEraserStroke[] | null>(null);
  const eraserFrameRef = useRef<number | null>(null);''')
s = replace(s, '''  const clearGesture = useCallback(() => {''', '''  const cancelEraserPaint = useCallback(() => {
    if (eraserFrameRef.current !== null) cancelAnimationFrame(eraserFrameRef.current);
    eraserFrameRef.current = null;
  }, []);

  const clearGesture = useCallback(() => {''')
s = replace(s, '''    (notifyMain: boolean) => {
      const gestureId''', '''    (notifyMain: boolean) => {
      cancelEraserPaint();
      const gestureId''')
s = replace(s, '''    [clearGesture],
  );

  const cancelGesture''', '''    [cancelEraserPaint, clearGesture],
  );

  useEffect(() => () => finishGestureState(true), [finishGestureState]);

  const cancelGesture''')
s = replace(s, '''      base.forEach((stroke) => {
        if (activeErasedIdsRef.current.has(stroke.id)) return;
        const hit = previous
          ? eraserSweepHitsStroke(
              previous,
              point,
              stroke,
              eraserRadiusRef.current,
            )
          : pointHitsStroke(point, stroke, eraserRadiusRef.current);
        if (hit) {
          activeErasedIdsRef.current.add(stroke.id);
          changed = true;
        }
      });''', '''      base.forEach((prepared) => {
        if (activeErasedIdsRef.current.has(prepared.stroke.id)) return;
        if (eraserSweepHitsPreparedStroke(
          previous ?? point, point, prepared, eraserRadiusRef.current,
        )) {
          activeErasedIdsRef.current.add(prepared.stroke.id);
          changed = true;
        }
      });''')
s = replace(s, '''    if (changed) renderCommitted();
  }

  function commitGesture''', '''    if (changed && eraserFrameRef.current === null) {
      const gestureId = activeGestureIdRef.current;
      eraserFrameRef.current = requestAnimationFrame(() => {
        eraserFrameRef.current = null;
        if (gestureId === activeGestureIdRef.current) renderCommitted();
      });
    }
  }

  function commitGesture''')
s = replace(s, 'eraserBaseRef.current = visibleStrokes();', 'eraserBaseRef.current = visibleStrokes().map(prepareEraserStroke);')
path.write_text(s, encoding='utf-8')

package = Path('package.json')
data = json.loads(package.read_text(encoding='utf-8'))
assert data['version'] == '0.3.3'
data['version'] = '0.3.4'
package.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
lock = Path('package-lock.json')
data = json.loads(lock.read_text(encoding='utf-8'))
data['version'] = data['packages']['']['version'] = '0.3.4'
lock.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

readme = Path('README.md')
s = readme.read_text(encoding='utf-8')
s += '''
## 0.3.4 판서 코어

- main process의 획 좌표는 입력 시 한 번 복사한 뒤 깊게 동결합니다. 같은 revision의 snapshot 조회는 캐시를 반환하고 Undo/Redo 및 체크포인트는 변경 불가능한 획을 공유합니다. renderer로 보내는 전체 문서 IPC는 여전히 문서 크기에 비례합니다.
- 지우개는 제스처 시작 시 획과 32선분 블록의 경계를 계산합니다. 경계 검사는 후보만 제외하며, 최종 판정은 기존 선분 거리 계산을 그대로 사용합니다.
- 지우개 미리보기는 한 프레임에 한 번으로 합치며 취소·도구 변경·unmount에서 예약된 그리기를 제거합니다.
- 테스트에서 깊은 불변성, revision 캐시 무효화, Undo/Redo/화면 재배치 복원, 기존 지우개 판정과의 무작위 동등성을 검증합니다. 전체 IPC·물리 GPU·장시간 세션의 성능 보증은 아닙니다.
'''
readme.write_text(s, encoding='utf-8')
print('Assembled immutable history, revision cache, prepared eraser geometry and frame-safe preview.')
