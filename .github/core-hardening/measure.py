from pathlib import Path
import runpy

runpy.run_path('.github/core-hardening/apply.py')

def replace(s, before, after):
    if s.count(before) != 1:
        raise RuntimeError(f'Expected one occurrence: {before[:100]!r}; got {s.count(before)}')
    return s.replace(before, after)

p = Path('src/components/AnnotationSurface.tsx')
s = p.read_text(encoding='utf-8')
s = replace(s, '''    const committed = documentRef.current?.strokes ?? [];
    const committedIds''', '''    const committed = documentRef.current?.strokes ?? [];
    if (!pendingStrokesRef.current.size && !pendingRemovalIdsRef.current.size && !activeErasedIdsRef.current.size) return committed;
    const committedIds''')
s = replace(s, '''    (next: AnnotationDocumentSnapshot) => {
      const committedIds''', '''    (next: AnnotationDocumentSnapshot) => {
      if (!pendingStrokesRef.current.size && !pendingRemovalIdsRef.current.size) return;
      const committedIds''')
p.write_text(s, encoding='utf-8')

p = Path('src/electron/interaction-smoke.ts')
s = p.read_text(encoding='utf-8')
s = replace(s, 'import { performance } from "node:perf_hooks";', '''import { performance } from "node:perf_hooks";
import { prepareEraserStroke, eraserSweepHitsPreparedStroke } from "../annotation/eraser-index.js";
import { eraserSweepHitsStroke } from "../annotation/geometry.js";''')
s = replace(s, '''    const snapshotMs = performance.now() - snapshotStart;
    const serializeStart''', '''    const snapshotMs = performance.now() - snapshotStart;
    const cacheStart = performance.now();
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      if (annotationHistory.getSnapshot(displayId) !== snapshot) throw new Error("Stable revision was unnecessarily cloned");
    }
    const cachedSnapshotReads1000Ms = performance.now() - cacheStart;
    const prepareStart = performance.now();
    const prepared = snapshot.strokes.map(prepareEraserStroke);
    const eraserPrepareMs = performance.now() - prepareStart;
    const sweepStart = { x: 350, y: 10 };
    const sweepEnd = { x: 450, y: 10 };
    const eraserQueryStats = { strokeBoundsTests: 0, blockBoundsTests: 0, segmentTests: 0 };
    const indexedStart = performance.now();
    const indexedIds = prepared.filter(item => eraserSweepHitsPreparedStroke(sweepStart, sweepEnd, item, 4, eraserQueryStats)).map(item => item.stroke.id);
    const indexedEraserMs = performance.now() - indexedStart;
    const referenceStart = performance.now();
    const referenceIds = snapshot.strokes.filter(item => eraserSweepHitsStroke(sweepStart, sweepEnd, item, 4)).map(item => item.id);
    const exhaustiveEraserMs = performance.now() - referenceStart;
    if (JSON.stringify(indexedIds) !== JSON.stringify(referenceIds)) throw new Error("Indexed eraser differs from exhaustive reference");
    if (eraserQueryStats.segmentTests >= 12800) throw new Error("Local eraser query traversed too much unrelated geometry");
    const serializeStart''')
s = replace(s, '''      snapshotMs,
      serializeMs,''', '''      snapshotMs,
      cachedSnapshotReads1000Ms,
      eraserPrepareMs,
      indexedEraserMs,
      exhaustiveEraserMs,
      eraserQueryStats,
      serializeMs,''')
s = replace(s, '''    const nativeDragIncludingInjectionMs = performance.now() - dragStart;
    await shortcutCommand("undo");''', '''    const nativeDragIncludingInjectionMs = performance.now() - dragStart;
    await shortcutCommand("undo");''')
# Exercise indexed erasing through actual OS input over the large document, not just a pure helper.
s = replace(s, '''      "native Undo on the large document",
    );
    const metrics''', '''      "native Undo on the large document",
    );
    await selectTool("eraser");
    await waitForOverlayInput(displayId, true);
    const eraseStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(
      () => annotationHistory.getSnapshot(displayId).strokes.length < snapshot.strokes.length,
      10_000,
      "native indexed erasing on the 128k-point document",
    );
    const nativeEraseIncludingInjectionMs = performance.now() - eraseStart;
    await shortcutCommand("undo");
    await waitFor(
      () => annotationHistory.getSnapshot(displayId).strokes.length === snapshot.strokes.length,
      10_000,
      "Undo restores every stroke removed by the indexed eraser",
    );
    if (JSON.stringify(annotationHistory.getSnapshot(displayId).strokes) !== JSON.stringify(snapshot.strokes)) throw new Error("Large eraser Undo changed the document geometry");
    const metrics''')
s = replace(s, '''      nativeDragIncludingInjectionMs,
      mainMemory:''', '''      nativeDragIncludingInjectionMs,
      nativeEraseIncludingInjectionMs,
      mainMemory:''')
p.write_text(s, encoding='utf-8')
print('Added immutable snapshot cache and indexed-eraser work counters to native Windows diagnostics.')
