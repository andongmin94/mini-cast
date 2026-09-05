from pathlib import Path
import json

def replace(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        raise RuntimeError(f'Expected {count}, found {n}: {old[:120]!r}')
    return s.replace(old, new)

def between(s, start, end, new):
    a, b = s.index(start), s.index(end, s.index(start))
    return s[:a] + new + s[b:]

p = Path('src/annotation/history.ts')
s = p.read_text()
s = replace(s, 'import { AnnotationError, type AnnotationFailureReason }', 'import { AnnotationError }')
s = between(s, 'export type AnnotationMutationResult =', 'interface IndexedStroke', '')
p.write_text(s)

p = Path('src/electron/main.ts')
s = p.read_text()
s = replace(s, '  type AnnotationMutationResult,\n', '')
s = 'import { createAnnotationUpdate, type AnnotationMutationResult } from "../annotation/document-sync.js";\n' + s
s = replace(s, 'const annotationHistory = new AnnotationHistory();', 'const annotationHistory = new AnnotationHistory();\nconst publishedDocuments = new Map<number, AnnotationDocumentSnapshot>();')
s = between(s, 'function sendAnnotationDocument(', 'function isTopLevelSender(', '''function sendAnnotationDocument(
  displayId: number,
  snapshot: AnnotationDocumentSnapshot = annotationHistory.getSnapshot(displayId),
  excludedWebContentsId: number | null = null,
) {
  const update = createAnnotationUpdate(publishedDocuments.get(displayId), snapshot);
  publishedDocuments.set(displayId, snapshot);
  overlayWindows.forEach((window, index) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    if (overlayDisplays[index]?.id === displayId && window.webContents.id !== excludedWebContentsId)
      sendToWindow(window, "annotation-document-updated", update);
  });
  return update;
}

function annotationMutationResult(
  displayId: number | null,
  reason: AnnotationFailureReason,
): AnnotationMutationResult {
  return {
    accepted: false,
    reason,
    update: displayId === null ? null : {
      kind: "revision", displayId, revision: annotationHistory.getSnapshot(displayId).revision,
    },
  };
}

''')
s = replace(s, '  if (!display) return;\n\n  sendToWebContents(event.sender, "overlay-init", {', '  if (!display) return;\n  const snapshot = annotationHistory.getSnapshot(display.id);\n  publishedDocuments.set(display.id, snapshot);\n\n  sendToWebContents(event.sender, "overlay-init", {')
s = replace(s, '    annotationHistory.getSnapshot(display.id),\n  );', '    { kind: "snapshot", document: snapshot },\n  );')
s = replace(s, '''        const document = annotationHistory.getSnapshot(displayId);
        sendAnnotationDocument(displayId, document, event.sender.id);
        return { accepted: true, document };''', '''        const update = sendAnnotationDocument(displayId, undefined, event.sender.id);
        return { accepted: true, update };''', 2)
s = replace(s, '    if (displayId === null) throw new Error("Invalid document request");', '    if (displayId === null || displayRebuildInProgress) throw new Error("Document is not available during display reconfiguration");')
s = replace(s, '    historyCheckpoint = annotationHistory.clone();\n', '    historyCheckpoint = annotationHistory.clone();\n    publishedDocuments.clear();\n')
s = replace(s, '    annotationHistory.retainDisplays(connectedIds);', '    annotationHistory.retainDisplays(connectedIds);\n    for (const id of publishedDocuments.keys()) if (!connectedIds.includes(id)) publishedDocuments.delete(id);')
s = replace(s, '      annotationHistory.restoreFrom(historyCheckpoint);', '      annotationHistory.restoreFrom(historyCheckpoint);\n      publishedDocuments.clear();\n      overlayDisplays.forEach(display => sendAnnotationDocument(display.id));')
p.write_text(s)

p = Path('src/electron-api.d.ts')
s = p.read_text()
s = replace(s, '  AnnotationMutationResult,\n', '')
s = 'import type { AnnotationDocumentUpdate, AnnotationMutationResult } from "./annotation/document-sync";\n' + s
s = replace(s, 'listener: (document: AnnotationDocumentSnapshot) => void,', 'listener: (update: AnnotationDocumentUpdate) => void,')
p.write_text(s)

p = Path('src/components/Overlay.tsx')
s = p.read_text()
s = replace(s, 'import { shouldAdoptAnnotationDocument } from "@/annotation/document-order";', 'import { AnnotationReplica, type AnnotationDocumentUpdate } from "@/annotation/document-sync";')
s = replace(s, '  const documentRevisionRef = useRef(-1);\n', '')
s = replace(s, '  const [displayId, setDisplayId] = useState<number | null>(null);', '''  const [displayId, setDisplayId] = useState<number | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [replica] = useState(() => new AnnotationReplica(
    () => miniCast.getAnnotationDocument(), setAnnotationDocument,
  ));''')
s = between(s, '  const adoptAnnotationDocument = useCallback(', '  useEffect(() => {\n    if (typeof miniCast', '''  const applyAnnotationUpdate = useCallback(async (update: AnnotationDocumentUpdate) => {
    try {
      const next = await replica.receive(update);
      if (next) setSyncNotice(null);
      return next;
    } catch (error) {
      setSyncNotice("판서 동기화에 실패했습니다. 다음 편집에서 상태를 다시 확인합니다.");
      throw error;
    }
  }, [replica]);

''')
s = replace(s, '      documentRevisionRef.current = -1;', '      replica.reset(physicalId);\n      setSyncNotice(null);')
s = replace(s, '      miniCast.onAnnotationDocumentUpdated(adoptAnnotationDocument),', '''      miniCast.onAnnotationDocumentUpdated((update) => {
        void applyAnnotationUpdate(update).catch(() => { /* The notice is already visible. */ });
      }),''')
s = replace(s, '      unsubscribe.forEach((stop) => stop());', '      unsubscribe.forEach((stop) => stop());\n      replica.reset(null);')
s = replace(s, '  }, [adoptAnnotationDocument]);', '  }, [applyAnnotationUpdate, replica]);')
s = replace(s, '        onAuthoritativeDocument={adoptAnnotationDocument}', '        onDocumentUpdate={applyAnnotationUpdate}')
s = replace(s, '      {mousePosition && passive', '''      {syncNotice && <div role="alert" className="fixed left-4 top-4 rounded bg-slate-900 p-3 text-sm text-white" style={{ zIndex: 5 }}>{syncNotice}</div>}

      {mousePosition && passive''')
p.write_text(s)

p = Path('src/components/AnnotationSurface.tsx')
s = p.read_text()
s = replace(s, 'import { annotationFailureMessage }', 'import type { AnnotationDocumentUpdate } from "@/annotation/document-sync";\nimport { paintCommittedAnnotations } from "@/annotation/canvas-renderer";\nimport { annotationFailureMessage }')
s = replace(s, '  planCommittedRender,\n', '')
s = replace(s, '  onAuthoritativeDocument(document: AnnotationDocumentSnapshot): void;', '  onDocumentUpdate(update: AnnotationDocumentUpdate): Promise<AnnotationDocumentSnapshot | null>;')
s = replace(s, '  onAuthoritativeDocument,\n', '  onDocumentUpdate,\n')
s = between(s, 'function drawStroke(', 'function drawActiveSegments(', '')
s = replace(s, '        strokeIds: strokes.map((stroke) => stroke.id),', '        pixelRatio: Math.max(window.devicePixelRatio || 1, 1),\n        strokes,')
s = between(s, '      const plan = forceReset', '      committedRenderStateRef.current = nextState;', '''      paintCommittedAnnotations(context, forceReset ? null : committedRenderStateRef.current, nextState);
''')
s = replace(s, '(next: AnnotationDocumentSnapshot, publish: boolean) => {', '(next: AnnotationDocumentSnapshot) => {')
s = replace(s, '      if (publish) onAuthoritativeDocument(next);\n', '')
s = replace(s, '    [onAuthoritativeDocument, reconcilePendingWithDocument],', '    [reconcilePendingWithDocument],')
s = replace(s, 'adoptAuthoritativeDocument(document, false)', 'adoptAuthoritativeDocument(document)')
s = replace(s, '''        .then((result) => {
          if (result.document) {
            adoptAuthoritativeDocument(result.document, true);
          }''', '''        .then(async (result) => {
          const next = result.update ? await onDocumentUpdate(result.update) : null;
          if (next) adoptAuthoritativeDocument(next);''', 2)
s = replace(s, '''            .then((next) => {
              if (adoptAuthoritativeDocument(next, true)) renderCommitted();
            })''', '''            .then(async (next) => {
              const current = await onDocumentUpdate({ kind: "snapshot", document: next });
              if (current && adoptAuthoritativeDocument(current)) renderCommitted();
            })''', 2)
p.write_text(s)

for name in ['package.json', 'package-lock.json']:
    p = Path(name)
    data = json.loads(p.read_text())
    data['version'] = '0.3.5'
    if 'packages' in data: data['packages']['']['version'] = '0.3.5'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print('Integrated delta transport, single-owner replica and clipped dirty-region painting.')
