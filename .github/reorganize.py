"""Prepare reviewed rotation changes in the existing opt-in Windows verification job.
The job publishes only after all checks succeed and deletes this preparation file.
"""
from pathlib import Path
import base64
import hashlib
import json
import re
import subprocess
import urllib.request

ROOT = Path('.')
BASE = 'fa2a35c4cfdcb4c40d17054b1df7889f5d49bd14'
assert json.loads(Path('package.json').read_text())['version'] == '0.6.0'

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, source):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(source,encoding='utf-8',newline='\n')

def replace(source, old, new, count=1):
    actual=source.count(old)
    if actual != count:
        raise RuntimeError(f'Expected {count} occurrences, got {actual}: {old[:160]}')
    return source.replace(old,new)

def section(source, start, end, replacement):
    a=source.index(start); b=source.index(end,a+len(start))
    return source[:a]+replacement+source[b:]

def array_after(source, marker, function):
    start=source.index(marker)
    pos=source.index('points:',start)+len('points:')
    a=source.index('[',pos); depth=0; quote=None; escape=False
    for b in range(a,len(source)):
        ch=source[b]
        if quote:
            if escape: escape=False
            elif ch=='\\': escape=True
            elif ch==quote: quote=None
        elif ch in ('"',"'",'`'): quote=ch
        elif ch=='[': depth+=1
        elif ch==']':
            depth-=1
            if depth==0:
                return source[:a]+function(source[a+1:b])+source[b+1:]
    raise RuntimeError('Unclosed points array')

FILES={
 'src/annotation/primitive-frame.ts':'73b37fec75d53ed043822fe604d7c67667c8c1c5',
 'src/annotation/rotation.ts':'976142eeed4cd6181f82197ab299180a1d644fec',
 'src/annotation/shape-geometry.ts':'c504da03c8a9a13210a4297bfa7408fca9b0137f',
 'tests/unit/annotation/rotation.test.mjs':'fa4a21ba369ba0ba5d4828da994b225dfd5fcd22',
 'src/electron/testing/rotation-smoke.ts':'cd4752d09058d84cc08adb5117886b73e4f76332',
}
for path,sha in FILES.items():
    request=urllib.request.Request(f'https://api.github.com/repos/andongmin94/mini-cast/git/blobs/{sha}',headers={'Accept':'application/vnd.github+json','User-Agent':'MiniCast-verification'})
    with urllib.request.urlopen(request,timeout=45) as response: blob=json.load(response)
    data=base64.b64decode(blob['content'])
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==sha
    write(path,data.decode('utf-8'))

p='src/annotation/history.ts';s=read(p)
s='import { frameCorners, validTextFrame } from "./primitive-frame.js";\nimport { normalizeRotation, rotatePoint } from "./rotation.js";\n'+s
s=replace(s,'  /** Start and end anchors, not a sampled freehand approximation. */','  /** Line/arrow: two endpoints. Rectangle/ellipse: origin, x end, y end. */')
s=replace(s,'  readonly scaleX: number;\n  readonly scaleY: number;\n','')
s=replace(s,'    scaleX: element.scaleX, scaleY: element.scaleY, box:','    box:')
s=replace(s,'    ...element, points, scaleX: element.scaleX * scaleX, scaleY: element.scaleY * scaleY,','    ...element, points,')
s=replace(s,'? { ...element, points, scaleX: element.scaleX * scaleX, scaleY: element.scaleY * scaleY }','? { ...element, points }')
s=section(s,'  if (resized.tool === "text") {','  return immutableElement(resized);','')
s=replace(s,'value.points.length !== 1 || value.opacity !== 1','value.points.length !== 3 || value.opacity !== 1 || "scaleX" in value || "scaleY" in value')
s=section(s,'    if (typeof value.scaleX !== "number"','    if (!isRecord(value.box))','')
s=replace(s,'    return (maxX as number) > (minX as number) && (maxY as number) > (minY as number);','    return (maxX as number) > (minX as number) && (maxY as number) > (minY as number) &&\n      validTextFrame(value.points as AnnotationPoint[], value.box as unknown as TextInkBox, MAX_ANNOTATION_COORDINATE);')
s=replace(s,'  if (isShapeTool(value.tool) && value.points.length !== 2) return false;','  if (isShapeTool(value.tool) && value.points.length !== (value.tool === "rectangle" || value.tool === "ellipse" ? 3 : 2)) return false;\n  if ((value.tool === "rectangle" || value.tool === "ellipse") &&\n      !frameCorners(value.points as AnnotationPoint[]).every(isFinitePoint)) return false;')
rotation='''/** Rotate every control point while retaining text frames, identity and style. */
export function rotateAnnotationElement(element: AnnotationElement, center: AnnotationPoint, radians: number): AnnotationElement {
  if (!isFinitePoint(center) || !isAnnotationElement(element)) throw new AnnotationError("invalid-element");
  const angle = normalizeRotation(radians);
  if (angle === 0) return element;
  const rotated = { ...element, points: element.points.map(point => rotatePoint(point, center, angle)) };
  if (!isAnnotationElement(rotated)) throw new AnnotationError("invalid-element");
  return immutableElement(rotated);
}

'''
s=replace(s,'/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */',rotation+'/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */')
s=replace(s,'  /** Build and validate every destination before replacing any source geometry. */','''  rotateElements(displayId: number, ids: Iterable<string>, center: AnnotationPoint, radians: number) {
    if (!isFinitePoint(center)) throw new AnnotationError("invalid-element");
    const angle = normalizeRotation(radians);
    return this.transformElements(displayId, ids, angle === 0,
      element => rotateAnnotationElement(element, center, angle));
  }

  /** Build and validate every destination before replacing any source geometry. */''')
write(p,s)

p='src/annotation/text.ts';s=read(p)
s='import { textControlPoints } from "./primitive-frame.js";\n'+s
a=s.rindex('  return {')
s=s[:a]+'''  return { id, tool: "text", points: textControlPoints(position), color,
    opacity: 1, text: valid.text, fontSize: valid.fontSize, box };
}
'''
write(p,s)

p='src/annotation/canvas-renderer.ts';s=read(p)
s=replace(s,'      context.translate(element.points[0].x, element.points[0].y);\n      context.scale(element.scaleX, element.scaleY);','''      const [origin, xEnd, yEnd] = element.points;
      context.transform(xEnd.x-origin.x, xEnd.y-origin.y, yEnd.x-origin.x, yEnd.y-origin.y, origin.x, origin.y);''')
s=replace(s,'''      const [a, b] = element.points;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      if (rx && ry) context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry, 0, 0, Math.PI * 2);
      else { context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); }''','''      const [a, b, c] = element.points;
      const ux=b.x-a.x, uy=b.y-a.y, vx=c.x-a.x, vy=c.y-a.y;
      if (ux*vy-uy*vx !== 0) {
        // The current path records transformed geometry. Restore before stroke
        // to preserve the product's scalar pen-width policy under affine resize.
        context.save();
        context.transform(ux, uy, vx, vy, a.x, a.y);
        context.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, Math.PI*2);
        context.restore();
      } else {
        context.moveTo(a.x,a.y); context.lineTo(b.x+c.x-a.x,b.y+c.y-a.y);
      }''')
write(p,s)

p='src/annotation/geometry.ts';s=read(p)
s='import { pointInFrame } from "./primitive-frame.js";\n'+s
s=replace(s,'elementInkBounds, elementInkPaths','textOutline, elementInkPaths')
s=replace(s,'''    const bounds = elementInkBounds(element);
    if (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds)) return true;
    paths = [rectangleOutline(bounds)];''','''    if (pointInFrame(start, element.points, element.box) || pointInFrame(end, element.points, element.box)) return true;
    paths = [textOutline(element)];''')
write(p,s)
p='src/annotation/eraser-index.ts';s=read(p)
s='import { pointInFrame } from "./primitive-frame.js";\n'+s
s=replace(s,'segmentToSegmentDistanceSquared, pointInsideBounds, rectangleOutline','segmentToSegmentDistanceSquared')
s=replace(s,'elementInkPaths, elementInkBounds,','elementInkPaths, textOutline,')
s=replace(s,'filled ? [rectangleOutline(elementInkBounds(stroke))] : elementInkPaths(stroke)','stroke.tool === "text" ? [textOutline(stroke)] : elementInkPaths(stroke)')
s=replace(s,'  if (filled && (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds))) return true;','  if (filled && prepared.stroke.tool === "text" && (pointInFrame(start, prepared.stroke.points, prepared.stroke.box) || pointInFrame(end, prepared.stroke.points, prepared.stroke.box))) return true;')
write(p,s)

p='src/annotation/selection.ts';s=read(p)
s='import { normalizeRotation, selectionRotationCenter } from "./rotation.js";\n'+s
s=replace(s,'  resizeAnnotationElement,','  resizeAnnotationElement,\n  rotateAnnotationElement,')
s=replace(s,'  | (SelectionEditBase & { readonly kind: "delete" });','  | (SelectionEditBase & { readonly kind: "rotate"; readonly radians: number })\n  | (SelectionEditBase & { readonly kind: "delete" });')
s=replace(s,'  if ((data.kind !== "move" && data.kind !== "resize")','''  if (data.kind === "rotate") {
    if (typeof data.radians !== "number") return null;
    try { return { kind: "rotate", revision: data.revision, ids, radians: normalizeRotation(data.radians) }; }
    catch { return null; }
  }
  if ((data.kind !== "move" && data.kind !== "resize")''')
s=replace(s,'  const transform = selectionResizeTransform(bounds, edit.handle, edit.dx, edit.dy, edit.lockAspect);','  if (edit.kind === "rotate") return history.rotateElements(displayId, edit.ids, selectionRotationCenter(bounds), edit.radians);\n  const transform = selectionResizeTransform(bounds, edit.handle, edit.dx, edit.dy, edit.lockAspect);')
s+='''
/** Rotate from the pointer-down document, with the same authoritative pivot. */
export function rotateSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, radians: number): readonly AnnotationElement[] {
  const angle = normalizeRotation(radians);
  if (angle === 0) return elements;
  const bounds = annotationSelectionBounds(elements, selected);
  if (!bounds) return elements;
  const center = selectionRotationCenter(bounds);
  return elements.map(element => selected.has(element.id) ? rotateAnnotationElement(element, center, angle) : element);
}
'''
write(p,s)

p='src/renderer/components/AnnotationSurface.tsx';s=read(p)
s='import { shapeControlPoints, framePoint } from "@/annotation/primitive-frame";\n'+s
s=replace(s,'points: [object.points[0], constrainedShapeEnd(object.tool, object.points[0], point, shift)]','points: shapeControlPoints(object.tool, object.points[0], constrainedShapeEnd(object.tool, object.points[0], point, shift))')
s=replace(s,'points: [point, point], color: settings.annotationPenColor','points: shapeControlPoints(tool, point, point), color: settings.annotationPenColor')
s=replace(s,'!hasShapeExtent(stroke.tool, stroke.points[0], stroke.points[1])','!hasShapeExtent(stroke.tool, stroke.points[0], stroke.tool === "rectangle" || stroke.tool === "ellipse" ? framePoint(stroke.points, 1, 1) : stroke.points[1])')
write(p,s)

p='src/renderer/components/AnnotationSelectionSurface.tsx';s=read(p)
s='import { rotationHandlePoint, ROTATION_HANDLE_SIZE, selectionRotationAngle, selectionRotationCenter } from "@/annotation/rotation";\n'+s
s=replace(s,'translateSelectionElements, resizeSelectionElements, type AnnotationSelectionEdit','translateSelectionElements, resizeSelectionElements, rotateSelectionElements, type AnnotationSelectionEdit')
s=replace(s,'  handle: ResizeHandle | null;','  handle: ResizeHandle | "rotate" | null;\n  radians: number;')
s=replace(s,'ids: readonly string[], handle: ResizeHandle | null)','ids: readonly string[], handle: ResizeHandle | "rotate" | null)')
s=replace(s,'lockAspect: event.shiftKey, dx: 0, dy: 0, preview: source.elements','lockAspect: event.shiftKey, radians: 0, dx: 0, dy: 0, preview: source.elements')
s=replace(s,'canvas.dataset.activeGesture = handle ? "resize" : "move";','canvas.dataset.activeGesture = handle === "rotate" ? "rotate" : handle ? "resize" : "move";')
s=replace(s,'canvas.style.cursor = handle ? resizeCursor(handle) : "grabbing";','canvas.style.cursor = handle && handle !== "rotate" ? resizeCursor(handle) : "grabbing";')
s=replace(s,'function handleResizeDown(event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle)','function handleResizeDown(event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle | "rotate")')
s=replace(s,'''      active.preview = active.handle
        ? resizeSelectionElements(active.source.elements, ids, active.handle, dx, dy, event.shiftKey)
        : translateSelectionElements(active.source.elements, ids, dx, dy);''','''      if (active.handle === "rotate") {
        const bounds = annotationSelectionBounds(active.source.elements, ids);
        if (!bounds) return;
        const angle = selectionRotationAngle(selectionRotationCenter(bounds), active.start, point, event.shiftKey);
        if (angle === null) return;
        active.radians = angle;
        active.preview = rotateSelectionElements(active.source.elements, ids, angle);
      } else {
        active.preview = active.handle
          ? resizeSelectionElements(active.source.elements, ids, active.handle, dx, dy, event.shiftKey)
          : translateSelectionElements(active.source.elements, ids, dx, dy);
      }''')
s=replace(s,'const edit: AnnotationSelectionEdit = active.handle\n      ?','const edit: AnnotationSelectionEdit = active.handle === "rotate"\n      ? { kind: "rotate", revision: active.source.revision, ids: active.ids, radians: active.radians }\n      : active.handle\n      ?')
s=replace(s,'  return (\n    <>','''  const rotateHandle = handleBounds ? rotationHandlePoint(handleBounds, { width: window.innerWidth, height: window.innerHeight }) : null;
  return (
    <>''')
marker='      <div className="pointer-events-auto fixed bottom-4'
assert s.count(marker)==1
s=s.replace(marker,'''      {rotateHandle && <button type="button" data-selection-rotate="" disabled={busy}
        aria-label="선택 객체 회전" title="드래그 회전 · Shift 15° 고정"
        onPointerDown={event => handleResizeDown(event, "rotate")}
        className="pointer-events-auto fixed flex items-center justify-center rounded-full border border-blue-600 bg-white text-blue-600"
        style={{ zIndex: 9, left: rotateHandle.x - ROTATION_HANDLE_SIZE / 2, top: rotateHandle.y - ROTATION_HANDLE_SIZE / 2,
          width: ROTATION_HANDLE_SIZE, height: ROTATION_HANDLE_SIZE, touchAction: "none", cursor: "grab" }}>↻</button>}
'''+marker)
s=replace(s,'aria-label="판서 객체 선택 및 이동"','aria-label="판서 객체 선택 및 변형"') if 'aria-label="판서 객체 선택 및 이동"' in s else s
write(p,s)

# Update the actual producers and fixtures to the one new frame contract.
# No legacy two-point boxes or scalar text transforms remain in runtime code.
p='src/electron/testing/resize-smoke.ts';s=read(p)
s='import { shapeControlPoints, textControlPoints, framePoint } from "../../annotation/primitive-frame.js";\n'+s
s=array_after(s,'id: "resize-rectangle"',lambda a:'shapeControlPoints("rectangle", '+a+')')
s=array_after(s,'id: "resize-text"',lambda a:'textControlPoints('+a+')')
s=replace(s,'fontSize: 24, scaleX: 1, scaleY: 1,','fontSize: 24,')
s=replace(s,'const edge = { x: rectangle.points[1].x, y: (rectangle.points[0].y + rectangle.points[1].y) / 2 };','const edge = framePoint(rectangle.points, 1, 0.5);')
s=replace(s,'  assert.equal(resizedText.scaleX, resizedText.scaleY, "Shift did not preserve text aspect");','  const [o, x, y] = resizedText.points;\n  assert.ok(Math.abs(Math.hypot(x.x-o.x,x.y-o.y)-Math.hypot(y.x-o.x,y.y-o.y)) < 1e-8, "Shift did not preserve text aspect");')
write(p,s)

p='src/electron/testing/interaction-smoke.ts';s=read(p)
s='import { framePoint } from "../../annotation/primitive-frame.js";\nimport { verifySelectionRotation } from "./rotation-smoke.js";\n'+s
s=replace(s,'element.points.length !== 2','element.points.length !== (tool === "rectangle" || tool === "ellipse" ? 3 : 2)')
s=replace(s,'display.bounds.x + element.points[0].x + (element.box.minX + element.box.maxX) * element.scaleX / 2','display.bounds.x + framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2).x')
s=replace(s,'display.bounds.y + element.points[0].y + (element.box.minY + element.box.maxY) * element.scaleY / 2','display.bounds.y + framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2).y')
# Insert after resize verification while still inside the native underlay lifetime.
start=s.index('      diagnostics.resizeTools = await verifySelectionResize(')
end=s.index(');',start)+2
s=s[:end]+'''
      diagnostics.rotationTools = await verifySelectionRotation({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand, state: context.state,
        activateSelection: async () => {
          if (!mainWindow) throw new Error("Missing controller for rotation");
          await clickControllerElement(mainWindow, '[data-annotation-tool="select"]', "selection for rotation");
          await waitFor(() => context.state().tool === "select", 5000, "selection for rotation active");
        },
      }, primary.id);'''+s[end:]
write(p,s)

p='src/electron/testing/rendering-smoke.ts';s=read(p)
s=replace(s,'["errors", "text", "history", "shape-geometry", "render-plan", "canvas-renderer"]','["errors", "primitive-frame", "rotation", "text", "history", "shape-geometry", "render-plan", "canvas-renderer"]')
s=array_after(s,'const shapeSet =',lambda a:'shapeControlPoints(tool, '+a+')')
marker="        elements = []; compare('mixed-clear');"
s=replace(s,marker,'''        for (const item of [...shapeSet, textElement, bottom, top]) {
          for (const angle of [Math.PI/2, Math.PI/4, -0.63, Math.PI]) {
            const saved = elements;
            elements = elements.map(element => element.id === item.id
              ? rotateAnnotationElement(element, {x:45,y:35}, angle) : element);
            compare('rotate-' + item.tool + '-' + angle);
            const rotated = elements;
            elements = elements.map(element => element.id === item.id
              ? resizeAnnotationElement(element, {x:15,y:12}, 1.3, 0.7) : element);
            compare('resize-rotated-' + item.tool);
            elements = rotated; compare('undo-resize-rotated-' + item.tool);
            elements = saved; compare('undo-rotate-' + item.tool);
          }
        }
'''+marker)
write(p,s)

p='tests/unit/annotation/shapes-and-text.test.mjs';s=read(p)
s='import { shapeControlPoints, textControlPoints } from "../../../dist/annotation/primitive-frame.js";\n'+s
s=array_after(s,'const shape =',lambda a:'shapeControlPoints(tool, '+a+')')
s=array_after(s,'const text =',lambda a:'textControlPoints('+a+')')
s=replace(s,'fontSize: 28, scaleX: 1, scaleY: 1,','fontSize: 28,')
s=replace(s,'assert.equal(stored.points.length, 2);','assert.equal(stored.points.length, tool === "rectangle" || tool === "ellipse" ? 3 : 2);')
s=array_after(s,'const narrow =',lambda a:'shapeControlPoints("ellipse", '+a+')')
s=array_after(s,'const element = { ...shape(tool)',lambda a:'shapeControlPoints(tool, '+a+')')
s=replace(s,'{ ...text(), scaleX: -1 }','{ ...text(), points: textControlPoints(point(20,20), -1, 1) }')
s=replace(s,'stored.text.length + 1','stored.text.length + 3')
s=replace(s,'assert.equal(after.scaleX, 2); assert.equal(after.scaleY, 0.5); assert.deepEqual(after.points, [point(40, 10)]);','assert.deepEqual(after.points, textControlPoints(point(40, 10), 2, 0.5));')
s=replace(s,'assert.deepEqual(before.points, [point(20, 20)]);','assert.deepEqual(before.points, textControlPoints(point(20, 20)));')
write(p,s)

p='tests/unit/annotation/selection.test.mjs';s=read(p)
s='import { shapeControlPoints, textControlPoints } from "../../../dist/annotation/primitive-frame.js";\n'+s
s=array_after(s,'const text =',lambda a:'textControlPoints('+a+')')
s=replace(s,'fontSize: 28, scaleX: 1, scaleY: 1,','fontSize: 28,')
s=array_after(s,'const shape = { ...line(tool)',lambda a:'shapeControlPoints(tool, '+a+')')
s=replace(s,'points: [{ x: 43, y: 73 }]','points: textControlPoints({ x: 43, y: 73 })')
s=replace(s,'{ ...line(tool), tool, opacity: tool === "highlighter" ? 0.35 : 1 }','{ ...line(tool), tool, points: shapeControlPoints(tool, {x:10,y:20}, {x:50,y:80}), opacity: tool === "highlighter" ? 0.35 : 1 }')
write(p,s)

p='tests/unit/annotation/resize.test.mjs';s=read(p)
s='import { shapeControlPoints, textControlPoints } from "../../../dist/annotation/primitive-frame.js";\n'+s
s=array_after(s,'const rectangle =',lambda a:'shapeControlPoints("rectangle", '+a+')')
s=array_after(s,'const text =',lambda a:'textControlPoints('+a+', 1.25, 0.8)')
s=replace(s,'fontSize: 28, scaleX: 1.25, scaleY: 0.8,','fontSize: 28,')
s=array_after(s,'{ ...rectangle("untouched")',lambda a:'shapeControlPoints("rectangle", '+a+')')
s=replace(s,'{ ...rectangle(tool), tool, opacity: tool === "highlighter" ? 0.35 : 1 }','{ ...rectangle(tool), tool, points: shapeControlPoints(tool, {x:20,y:30}, {x:120,y:90}), opacity: tool === "highlighter" ? 0.35 : 1 }')
s=replace(s,'assert.deepEqual(next.points, [{ x: 270, y: 65 }]);','assert.deepEqual(next.points[0], { x: 270, y: 65 });')
s=replace(s,'close(next.scaleX, 2.5); close(next.scaleY, 0.4);','close(next.points[1].x-next.points[0].x, 2.5); close(next.points[2].y-next.points[0].y, 0.4);')
s=replace(s,'{ ...text, scaleX: 100000 }','{ ...text, points: textControlPoints(text.points[0], 100000, 1) }')
write(p,s)

p='scripts/verify-diagnostics.ps1';s=read(p)
s=replace(s,'  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"','''  foreach ($name in @('handle','noOp','rotate','groupShift','undoRedo','pixels','heldUndo','staleRevision','activeReload','heldEscape')) {
    if (-not $result.diagnostics.rotationTools.$name) { throw "Missing rotation verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')
write(p,s)

p='package.json';data=json.loads(read(p));data['version']='0.7.0';write(p,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
p='package-lock.json';data=json.loads(read(p));data['version']='0.7.0';data['packages']['']['version']='0.7.0';write(p,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
subprocess.run(['git','add','package-lock.json'],check=True)
p='docs/ANNOTATION-TOOLS.md';s=read(p)
s+='''

## 선택 회전 (0.7.0)

선택 테두리 바깥의 원형 회전 핸들을 드래그합니다. Shift를 누르면 시작 방향으로부터 15도 간격으로 고정됩니다. 같은 모니터에서 여러 객체를 선택하면 하나의 그룹 중심을 기준으로 회전하며 한 번의 Undo로 모두 복원합니다. 핸들 가장자리를 눌러도 처음부터 방향이 튀지 않으며, 중심 바로 근처에서는 마지막 유효 각도를 유지합니다.

사각형·타원은 두 대각점 대신 원점과 두 축 끝점으로 저장합니다. 텍스트도 같은 세 점으로 글자 레이아웃의 방향과 배율을 표현합니다. 구형 축 정렬 계약과 텍스트 scaleX/scaleY 필드는 제거했습니다. 회전 후 비균등 크기 조절은 화면 축 방향의 affine 변형이므로 사각형이 평행사변형이 될 수 있으며, 이를 축 정렬 사각형으로 강제 변환하지 않습니다. 타원은 계속 해석적인 곡선으로 렌더링합니다. 자유곡선·직선·화살표는 기존 점을 회전하며 회전만으로 굵기·색·투명도는 바뀌지 않습니다.

회전한 텍스트의 빈 AABB 모서리는 선택·지우개 대상이 아닙니다. 실제 변환된 글자 배치 사각형을 검사합니다. Ctrl+Z는 진행 중 회전만 취소하고 Escape는 클릭 통과로 복귀합니다. 재로딩이나 다른 편집으로 revision이 바뀌면 미완성 회전을 버립니다. 확정한 텍스트 내용 재편집·반전은 이번 범위에 포함하지 않습니다.
'''
write(p,s)
p='docs/CHANGELOG.md';s=read(p);write(p,'## 0.7.0\n\n- 단일·그룹 회전, Shift 15도 고정, 원자적 Undo/Redo.\n- 도형·텍스트의 affine 제어점, 회전 후 비균등 확대와 정확한 hit test.\n- 회전 네이티브 입력과 부분/전체 Canvas 비교 검증 추가.\n\n'+s)
p='README.md';s=read(p);s+='\n선택 객체는 회전 핸들로 회전하며 Shift로 15도 간격을 고정합니다. 세부 동작은 `docs/ANNOTATION-TOOLS.md`를 참조하세요.\n';write(p,s)

# Record the exact prepared source before any runner-side validation.
Path('verification-logs').mkdir(exist_ok=True)
manifest={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('src').rglob('*') if p.is_file()}
write('verification-logs/rotation-source-manifest.json',json.dumps(manifest,indent=2)+'\n')
hook=Path('.git/hooks/prepare-commit-msg')
hook.write_text('#!/bin/sh\nprintf "%s\\n" "feat: add affine annotation rotation (0.7.0)" > "$1"\n',encoding='utf-8',newline='\n')
hook.chmod(0o755)
print('Prepared rotation source. Typecheck, unit tests, native input, packages and ZIP verification must all succeed before publication.')
