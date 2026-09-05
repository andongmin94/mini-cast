"""Apply the reviewed shape-fill increment in the opt-in Windows verification job.
The job commits only after source, native input, package and ZIP checks succeed.
This one-run preparation file is removed by the job; no branch or trigger is added.
"""
from pathlib import Path
import json
import subprocess

BASE = '8a7b9f0e21e1b9456d2c5fe5be534fa3fa278ca4'
package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
check = package['scripts']['check']
guarded = dict(package, scripts=dict(package['scripts'], check='node -e "throw new Error(\'Shape-fill preparation did not complete\')"'))
package_path.write_text(json.dumps(guarded, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
subprocess.run(['git', 'fetch', '--depth=1', 'origin', BASE], check=True)
changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD', '--', 'src', 'tests', 'scripts', 'docs', 'package.json', 'package-lock.json'], text=True)
if changed.strip():
    raise SystemExit('The reviewed product base changed; refusing to overwrite it: ' + changed)
if package['version'] != '0.9.0':
    raise SystemExit('Expected product version 0.9.0')

def replace(path, old, new, count=1):
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    found = source.count(old)
    if found != count:
        raise SystemExit(f'{path}: expected {count} targets, found {found}: {old[:120]!r}')
    file.write_text(source.replace(old, new), encoding='utf-8', newline='\n')

def write(path, text):
    file = Path(path)
    if file.exists():
        raise SystemExit(f'Refusing to replace unreviewed new file: {path}')
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text.lstrip('\n'), encoding='utf-8', newline='\n')

# Absence of a fill is the explicit outline-only style, not a second document format.
history = 'src/annotation/history.ts'
replace(history, 'export interface ShapeElement extends ElementStyle {\n', 'export interface ShapeElement extends ElementStyle {\n  /** Solid interior color for rectangle/ellipse; absent means outline only. */\n  readonly fill?: string;\n')
replace(history, '  return Object.freeze({ ...common, tool: element.tool, width: element.width });', '''  return Object.freeze({ ...common, tool: element.tool, width: element.width,
    ...((element.tool === "rectangle" || element.tool === "ellipse") && element.fill !== undefined
      ? { fill: element.fill } : {}),
  });''')
replace(history, '  if (value.tool === "text") {\n    const draft = readAnnotationTextDraft(value);', '''  if ("fill" in value && ((value.tool !== "rectangle" && value.tool !== "ellipse") ||
      typeof value.fill !== "string" || !HEX_COLOR.test(value.fill))) return false;
  if (value.tool === "text") {
    const draft = readAnnotationTextDraft(value);''')
replace(history, '/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */', '''/** Null removes the fill; only bounded solid RGB colors enter the document. */
export function isAnnotationFill(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && HEX_COLOR.test(value));
}

export function isFillableShape(element: AnnotationElement): element is ShapeElement & { tool: "rectangle" | "ellipse" } {
  return element.tool === "rectangle" || element.tool === "ellipse";
}

/** A style edit retains the original geometry, stacking order and stroke. */
export function fillAnnotationElement(element: AnnotationElement, fill: string | null): AnnotationElement {
  if (!isAnnotationFill(fill) || !isAnnotationElement(element) || !isFillableShape(element))
    throw new AnnotationError("invalid-element");
  const color = fill === null ? null : fill.toUpperCase();
  if ((element.fill?.toUpperCase() ?? null) === color) return element;
  const result = { ...element };
  if (color === null) delete result.fill;
  else result.fill = color;
  return immutableElement(result);
}

/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */''')
replace(history, '  editText(displayId: number, id: string, value: unknown) {', '''  fillElements(displayId: number, ids: Iterable<string>, fill: string | null) {
    if (!isAnnotationFill(fill)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, false,
      element => fillAnnotationElement(element, fill));
  }

  editText(displayId: number, id: string, value: unknown) {''')

# Share inverse-frame arithmetic with text hits. Negative determinant is valid reflection.
frame = 'src/annotation/primitive-frame.ts'
replace(frame, '''export function pointInFrame(point: AnnotationPoint, points: readonly AnnotationPoint[], box: TextInkBox): boolean {
  const [origin, xEnd, yEnd] = points;''', '''export function frameCoordinates(point: AnnotationPoint, points: readonly AnnotationPoint[]): AnnotationPoint | null {
  if (points.length !== 3) return null;
  const [origin, xEnd, yEnd] = points;''')
replace(frame, '''  if (!Number.isFinite(determinant) || determinant === 0) return false;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  const x = (d * dx - c * dy) / determinant;
  const y = (a * dy - b * dx) / determinant;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;''', '''  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  const x = (d * dx - c * dy) / determinant;
  const y = (a * dy - b * dx) / determinant;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function pointInFrame(point: AnnotationPoint, points: readonly AnnotationPoint[], box: TextInkBox): boolean {
  const local = frameCoordinates(point, points);
  return local !== null && local.x >= box.minX && local.x <= box.maxX && local.y >= box.minY && local.y <= box.maxY;''')
shape = 'src/annotation/shape-geometry.ts'
replace(shape, 'import { frameCorners, framePoint } from "./primitive-frame.js";', 'import { frameCorners, framePoint, frameCoordinates, pointInFrame } from "./primitive-frame.js";')
replace(shape, 'const boundsCache = new WeakMap<AnnotationElement, InkBounds>();', '''/** Exact interior hit in local coordinates; outline-only shapes never hit inside. */
export function pointInElementFill(point: AnnotationPoint, element: AnnotationElement): boolean {
  if (element.tool === "text") return pointInFrame(point, element.points, element.box);
  if ((element.tool !== "rectangle" && element.tool !== "ellipse") || element.fill === undefined) return false;
  const local = frameCoordinates(point, element.points);
  if (!local) return false;
  if (element.tool === "rectangle") return local.x >= 0 && local.x <= 1 && local.y >= 0 && local.y <= 1;
  return (local.x - 0.5) ** 2 + (local.y - 0.5) ** 2 <= 0.25;
}

const boundsCache = new WeakMap<AnnotationElement, InkBounds>();''')
geometry = 'src/annotation/geometry.ts'
replace(geometry, 'import { pointInFrame } from "./primitive-frame.js";\n', '')
replace(geometry, 'import { textOutline, elementInkPaths, ELLIPSE_FLATTENING_ERROR, type InkBounds }', 'import { pointInElementFill, textOutline, elementInkPaths, ELLIPSE_FLATTENING_ERROR, type InkBounds }')
replace(geometry, '  if (!element.points.length) return false;\n  let paths:', '  if (!element.points.length) return false;\n  if (pointInElementFill(start, element) || pointInElementFill(end, element)) return true;\n  let paths:')
replace(geometry, '    if (pointInFrame(start, element.points, element.box) || pointInFrame(end, element.points, element.box)) return true;\n', '')
eraser = 'src/annotation/eraser-index.ts'
replace(eraser, 'import { pointInFrame } from "./primitive-frame.js";\n', '')
replace(eraser, 'import { elementInkPaths, textOutline, ELLIPSE_FLATTENING_ERROR }', 'import { pointInElementFill, elementInkPaths, textOutline, ELLIPSE_FLATTENING_ERROR }')
replace(eraser, '  const filled = stroke.tool === "text";', '  const filled = stroke.tool === "text" || ((stroke.tool === "rectangle" || stroke.tool === "ellipse") && stroke.fill !== undefined);')
replace(eraser, '  if (filled && prepared.stroke.tool === "text" && (pointInFrame(start, prepared.stroke.points, prepared.stroke.box) || pointInFrame(end, prepared.stroke.points, prepared.stroke.box))) return true;', '  if (filled && (pointInElementFill(start, prepared.stroke) || pointInElementFill(end, prepared.stroke))) return true;')
renderer = 'src/annotation/canvas-renderer.ts'
replace(renderer, '    context.stroke();\n  } finally { context.restore(); }', '''    if ((element.tool === "rectangle" || element.tool === "ellipse") && element.fill !== undefined) {
      context.fillStyle = element.fill;
      context.fill();
    }
    context.stroke();
  } finally { context.restore(); }''')

selection = 'src/annotation/selection.ts'
replace(selection, '  flipAnnotationElement,\n', '  flipAnnotationElement,\n  fillAnnotationElement,\n  isAnnotationFill,\n')
replace(selection, '  | (SelectionEditBase & { readonly kind: "delete" });', '  | (SelectionEditBase & { readonly kind: "fill"; readonly fill: string | null })\n  | (SelectionEditBase & { readonly kind: "delete" });')
replace(selection, '  if (data.kind === "delete") return { kind: "delete", revision: data.revision, ids };', '''  if (data.kind === "fill") return isAnnotationFill(data.fill)
    ? { kind: "fill", revision: data.revision, ids, fill: data.fill } : null;
  if (data.kind === "delete") return { kind: "delete", revision: data.revision, ids };''')
replace(selection, '  if (edit.kind === "delete") return history.removeElements(displayId, edit.ids);', '''  if (edit.kind === "fill") return history.fillElements(displayId, edit.ids, edit.fill);
  if (edit.kind === "delete") return history.removeElements(displayId, edit.ids);''')
with Path(selection).open('a', encoding='utf-8') as file:
    file.write('''
/** Style preview shares the same validation as the atomic history edit. */
export function fillSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, fill: string | null): readonly AnnotationElement[] {
  return elements.map(element => selected.has(element.id) ? fillAnnotationElement(element, fill) : element);
}
''')

contract = 'src/shared/contract.ts'
replace(contract, 'export interface AnnotationPreferences {\n', 'export interface AnnotationPreferences {\n  annotationShapeFillEnabled: boolean;\n  annotationShapeFillColor: string;\n')
replace(contract, '  annotationPenColor: "#FF3B30",', '  annotationShapeFillEnabled: false,\n  annotationShapeFillColor: "#FFFFFF",\n  annotationPenColor: "#FF3B30",')
replace('src/shared/settings.ts', '    annotationPenColor: readHexColor(', '''    annotationShapeFillEnabled: readBoolean(source, "annotationShapeFillEnabled", DEFAULT_OVERLAY_SETTINGS.annotationShapeFillEnabled),
    annotationShapeFillColor: readHexColor(source, "annotationShapeFillColor", DEFAULT_OVERLAY_SETTINGS.annotationShapeFillColor),
    annotationPenColor: readHexColor(''')
controller = 'src/renderer/components/Controller.tsx'
replace(controller, '    annotationPenColor: settings.annotationPenColor,', '''    annotationShapeFillEnabled: settings.annotationShapeFillEnabled,
    annotationShapeFillColor: settings.annotationShapeFillColor,
    annotationPenColor: settings.annotationPenColor,''', count=2)
controls = 'src/renderer/components/AnnotationControls.tsx'
replace(controls, '      {tool === "text" && <AnnotationTextComposer', '''      <fieldset className="bg-muted space-y-2 rounded-md p-3">
        <legend className="px-1 text-xs font-medium">사각형·타원 채우기</legend>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" data-annotation-shape-fill="" checked={settings.annotationShapeFillEnabled}
            onChange={event => onSettingChange("annotationShapeFillEnabled", event.target.checked)} />
          새 사각형·타원 내부 채우기
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          채우기 색상
          <input type="color" data-annotation-shape-fill-color="" value={settings.annotationShapeFillColor}
            onChange={event => onSettingChange("annotationShapeFillColor", event.target.value)}
            className="color-picker rounded-md px-1 py-0.5" />
        </label>
        <p className="text-muted-foreground text-[11px]">기존 도형은 선택 후 ‘채우기 적용’ 또는 ‘채우기 제거’를 누르세요. 윤곽선 색상은 유지됩니다.</p>
      </fieldset>

      {tool === "text" && <AnnotationTextComposer''')
surface = 'src/renderer/components/AnnotationSurface.tsx'
replace(surface, 'points: shapeControlPoints(tool, point, point), color: settings.annotationPenColor,', 'points: shapeControlPoints(tool, point, point),\n        ...((tool === "rectangle" || tool === "ellipse") && settings.annotationShapeFillEnabled\n          ? { fill: settings.annotationShapeFillColor } : {}), color: settings.annotationPenColor,')
overlay = 'src/renderer/components/Overlay.tsx'
replace(overlay, '<AnnotationSelectionSurface key={displayId} displayId={displayId}\n', '<AnnotationSelectionSurface key={displayId} displayId={displayId} fillColor={settings.annotationShapeFillColor}\n')
selected = 'src/renderer/components/AnnotationSelectionSurface.tsx'
replace(selected, 'import type { AnnotationDocumentSnapshot, AnnotationElement, AnnotationPoint, FlipAxis } from "@/annotation/history";', 'import { isFillableShape, type AnnotationDocumentSnapshot, type AnnotationElement, type AnnotationPoint, type FlipAxis } from "@/annotation/history";')
replace(selected, 'translateSelectionElements, resizeSelectionElements, rotateSelectionElements,', 'translateSelectionElements, resizeSelectionElements, rotateSelectionElements, fillSelectionElements,')
replace(selected, 'interface Props {\n', 'interface Props {\n  fillColor: string;\n')
replace(selected, 'function AnnotationSelectionSurface({ displayId, document, onDocumentUpdate }: Props)', 'function AnnotationSelectionSurface({ displayId, document, fillColor, onDocumentUpdate }: Props)')
replace(selected, '  const [canEditText, setCanEditText] = useState(false);', '  const [canEditText, setCanEditText] = useState(false);\n  const [canFill, setCanFill] = useState(false);')
replace(selected, '      setCount(ids.length);', '''      setCount(ids.length);
      setCanFill(ids.length > 0 && ids.every(id => {
        const element = current.current?.elements.find(item => item.id === id);
        return element !== undefined && isFillableShape(element);
      }));''')
replace(selected, '    if (retained.length !== selected.current.length) setSelection(retained);', '    setSelection(retained);')
replace(selected, '  function deleteSelected() {', '''  function fillSelected(fill: string | null) {
    const source = current.current;
    if (!source || pending.current || drag.current || openingEditor.current || !selected.current.length) return;
    const ids = [...selected.current];
    try {
      const preview = fillSelectionElements(source.elements, new Set(ids), fill);
      const id = crypto.randomUUID();
      setNotice(null);
      miniCast.beginAnnotationGesture(id);
      void submit(id, { kind: "fill", revision: source.revision, ids, fill }, preview);
    } catch {
      setNotice("사각형·타원만 선택해야 채우기를 바꿀 수 있습니다. 기존 판서는 유지됩니다.");
    }
  }

  function deleteSelected() {''')
replace(selected, '        <button type="button" data-selection-text-edit=""', '''        <button type="button" data-selection-fill="" disabled={busy || !canFill}
          title="컨트롤러의 채우기 색상 적용" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40"
          onClick={() => fillSelected(fillColor)}><span aria-hidden="true" className="inline-block size-3 rounded-sm border border-white" style={{ backgroundColor: fillColor }} />채우기 적용</button>
        <button type="button" data-selection-unfill="" disabled={busy || !canFill}
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40" onClick={() => fillSelected(null)}>채우기 제거</button>
        <button type="button" data-selection-text-edit=""''')

write('tests/unit/annotation/fill.test.mjs', r'''
import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, fillAnnotationElement, isAnnotationElement, isAnnotationFill, rotateAnnotationElement, resizeAnnotationElement, flipAnnotationElement } from "../../../dist/annotation/history.js";
import { applyAnnotationSelectionEdit, fillSelectionElements, readAnnotationSelectionEdit, hitTestAnnotationSelection } from "../../../dist/annotation/selection.js";
import { shapeControlPoints, textControlPoints, framePoint, frameCoordinates } from "../../../dist/annotation/primitive-frame.js";
import { pointInElementFill, elementInkBounds } from "../../../dist/annotation/shape-geometry.js";
import { pointHitsStroke, eraserSweepHitsStroke } from "../../../dist/annotation/geometry.js";
import { prepareEraserElement, eraserSweepHitsPreparedElement } from "../../../dist/annotation/eraser-index.js";
import { AnnotationReplica, createAnnotationUpdate } from "../../../dist/annotation/document-sync.js";
import { normalizeOverlaySettings } from "../../../dist/shared/settings.js";
import { DEFAULT_OVERLAY_SETTINGS } from "../../../dist/shared/contract.js";

const point = (x,y) => ({x,y});
const shape = (tool = "rectangle", id = tool) => ({ id, tool, color: "#123456", width: 4, opacity: 1,
  points: shapeControlPoints(tool, point(20,30), point(140,110)) });
const pen = () => ({ id:"pen",tool:"pen",color:"#123456",width:4,opacity:1,points:[point(5,5),point(10,10)] });
function setup() { const h = new AnnotationHistory(); h.setDisplayViewport(1,800,600); h.addElement(1,shape()); h.addElement(1,shape("ellipse")); return h; }
function edit(h, ids, fill, revision = h.getSnapshot(1).revision) { return applyAnnotationSelectionEdit(h,1,{kind:"fill",revision,ids,fill}); }

test("fill validation admits only solid closed-shape colors and explicit removal commands", () => {
  for (const value of [null,"#123456","#abcdef"]) assert.equal(isAnnotationFill(value),true);
  for (const value of [undefined,"",false,{},"red","#fff","#12345678","url(x)","rgba(0,0,0,1)"]) assert.equal(isAnnotationFill(value),false);
  assert.equal(isAnnotationElement({...shape(),fill:"#AbCdEf"}),true);
  for (const fill of [null,undefined,"",false,"red","#12345678"]) assert.equal(isAnnotationElement({...shape(),fill}),false);
  for (const tool of ["line","arrow"]) assert.equal(isAnnotationElement({...shape(tool),fill:"#123456"}),false);
  assert.equal(isAnnotationElement({...pen(),fill:"#123456"}),false);
  assert.equal(readAnnotationSelectionEdit({kind:"fill",revision:0,ids:["rectangle"]}),null);
  assert.equal(readAnnotationSelectionEdit({kind:"fill",revision:0,ids:["rectangle","rectangle"],fill:null}),null);
});

for (const tool of ["rectangle","ellipse"]) test(`${tool} fill editing has identical preview/commit and exact Undo/Redo`, () => {
  const h = new AnnotationHistory(); h.addElement(1,shape(tool)); const before=h.getSnapshot(1);
  const preview=fillSelectionElements(before.elements,new Set([tool]),"#24a148");
  edit(h,[tool],"#24a148"); const after=h.getSnapshot(1);
  assert.deepEqual(after.elements,preview); assert.equal(after.elements[0].fill,"#24A148");
  assert.equal(after.revision,before.revision+1); assert.deepEqual(after.elements[0].points,before.elements[0].points);
  assert.equal(after.elements[0].color,before.elements[0].color); assert.equal(after.elements[0].width,4);
  assert.ok(Object.isFrozen(after.elements[0])); assert.ok(Object.isFrozen(after.elements[0].points[0]));
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements,before.elements);
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements,after.elements);
  edit(h,[tool],null); assert.equal("fill" in h.getSnapshot(1).elements[0],false);
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements,after.elements);
});

test("same fill and removal of an absent fill preserve snapshot, revision, history and Redo", () => {
  const h=setup(); h.addElement(2,pen()); h.undo(); const before=h.getSnapshot(1);
  assert.equal(edit(h,["rectangle","ellipse"],null),null); assert.strictEqual(h.getSnapshot(1),before); assert.equal(h.canRedo,true);
  edit(h,["rectangle"],"#ABCDEF"); h.addElement(2,pen()); h.undo(); const colored=h.getSnapshot(1);
  assert.equal(edit(h,["rectangle"],"#abcdef"),null); assert.strictEqual(h.getSnapshot(1),colored); assert.equal(h.canRedo,true);
});

test("one group fill retains order, geometry and unselected references in a single history entry", () => {
  const h=setup(); h.addElement(1,pen()); const before=h.getSnapshot(1);
  edit(h,["rectangle","ellipse"],"#336699"); const after=h.getSnapshot(1);
  assert.deepEqual(after.elements.map(e=>e.id),before.elements.map(e=>e.id));
  assert.strictEqual(after.elements[2],before.elements[2]);
  h.undo(); assert.deepEqual(h.getSnapshot(1).elements,before.elements);
  h.redo(); assert.deepEqual(h.getSnapshot(1).elements,after.elements);
});

test("a mixed unsupported selection, stale revision or invalid fill rejects the entire group", () => {
  const h=setup();h.addElement(1,pen());const before=h.getSnapshot(1);
  for(const action of [()=>edit(h,["rectangle","pen"],"#FFFFFF"),()=>edit(h,["rectangle","absent"],"#FFFFFF"),
    ()=>edit(h,["rectangle"],"#FFFFFF",before.revision-1),()=>edit(h,["rectangle"],"url(x)")]) {
    assert.throws(action);assert.strictEqual(h.getSnapshot(1),before);
  }
  const text={id:"text",tool:"text",color:"#123456",opacity:1,text:"ABC",fontSize:28,box:{minX:0,minY:0,maxX:100,maxY:40},points:textControlPoints(point(20,20))};
  assert.throws(()=>fillAnnotationElement(text,"#FFFFFF"));assert.equal(isAnnotationElement({...text,fill:"#FFFFFF"}),false);
});

test("fill application and clearing do not change the bounded element/point cost", () => {
  const h=setup();const before=h.getSnapshot(1);
  for(let i=0;i<600;i++) { edit(h,["rectangle","ellipse"],i%2?null:"#123456");assert.equal(h.getSnapshot(1).elements.length,2); }
  const last=h.getSnapshot(1);h.undo();h.redo();assert.deepEqual(h.getSnapshot(1).elements,last.elements);
  assert.equal(before.elements[0].fill,undefined);assert.equal(before.elements[1].fill,undefined);
});

for(const tool of ["rectangle","ellipse"]) test(`${tool} fill survives rotation, reflection, shear and viewport/history changes`, () => {
  const e=fillAnnotationElement(shape(tool),"#FEDCBA");
  const transformed=flipAnnotationElement(resizeAnnotationElement(rotateAnnotationElement(e,point(80,70),.63),point(80,70),1.6,.7),point(80,70),"horizontal");
  assert.equal(isAnnotationElement(transformed),true);assert.equal(transformed.fill,"#FEDCBA");
  const inside=framePoint(transformed.points,.5,.5);assert.equal(pointInElementFill(inside,transformed),true);
  assert.equal(pointHitsStroke(inside,transformed,0),true);
  const h=new AnnotationHistory();h.setDisplayViewport(1,800,600);h.addElement(1,transformed);const original=h.getSnapshot(1);
  edit(h,[tool],"#FFFFFF");const checkpoint=h.clone();h.setDisplayViewport(1,1200,300);
  assert.equal(h.getSnapshot(1).elements[0].fill,"#FFFFFF");h.undo();assert.equal(h.getSnapshot(1).elements[0].fill,"#FEDCBA");
  h.redo();assert.equal(h.getSnapshot(1).elements[0].fill,"#FFFFFF");h.restoreFrom(checkpoint);h.undo();assert.deepEqual(h.getSnapshot(1).elements,original.elements);
});

test("filled interiors are selectable; hollow interiors and empty ellipse corners remain transparent", () => {
  for(const tool of ["rectangle","ellipse"]) {
    const e=shape(tool),filled=fillAnnotationElement(e,"#FFFFFF"),c=framePoint(e.points,.5,.5);
    assert.equal(pointHitsStroke(c,e,0),false);assert.equal(eraserSweepHitsPreparedElement(c,c,prepareEraserElement(e),0),false);
    assert.equal(pointHitsStroke(c,filled,0),true);assert.equal(eraserSweepHitsPreparedElement(c,c,prepareEraserElement(filled),0),true);
    assert.equal(hitTestAnnotationSelection([e,filled],c,0),filled.id);
    const outside=framePoint(e.points,-.3,1.3);assert.equal(pointInElementFill(outside,filled),false);
  }
  const ellipse=fillAnnotationElement(shape("ellipse"),"#FFFFFF"),corner=framePoint(ellipse.points,.01,.01);
  assert.equal(pointInElementFill(corner,ellipse),false);assert.equal(pointHitsStroke(corner,ellipse,0),false);
});

test("filled sweeps hit crossings and internal endpoints, not empty space in transformed AABBs", () => {
  for(const tool of ["rectangle","ellipse"]) {
    const e=fillAnnotationElement(shape(tool),"#FFFFFF"),a=framePoint(e.points,-1,.5),b=framePoint(e.points,2,.5),c=framePoint(e.points,.5,.5);
    assert.equal(eraserSweepHitsStroke(a,b,e,0),true);assert.equal(eraserSweepHitsPreparedElement(a,b,prepareEraserElement(e),0),true);
    assert.equal(eraserSweepHitsStroke(c,c,e,0),true);
    const r=rotateAnnotationElement(e,point(80,70),Math.PI/4),bounds=elementInkBounds(r),outside=point(bounds.minX+.1,bounds.minY+.1);
    assert.equal(eraserSweepHitsPreparedElement(outside,outside,prepareEraserElement(r),0),false);
  }
});

test("filled affine shape fast erasing agrees with exhaustive geometry in 2000 seeded cases", () => {
  let seed=174;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<2000;i++) {
    let e=fillAnnotationElement(shape(i%2?"rectangle":"ellipse"),"#24A148");
    e=rotateAnnotationElement(e,point(80,70),rand()*Math.PI*2);
    e=resizeAnnotationElement(e,point(80,70),.4+rand()*2,.4+rand()*2);
    if(i%3===0)e=flipAnnotationElement(e,point(80,70),"vertical");
    const a=point(rand()*400-100,rand()*300-80),b=point(rand()*400-100,rand()*300-80),radius=rand()*12;
    assert.equal(eraserSweepHitsPreparedElement(a,b,prepareEraserElement(e),radius),eraserSweepHitsStroke(a,b,e,radius),`case ${i}`);
  }
});

test("collapsed frames have no filled interior and inverse coordinates reject nonfinite input", () => {
  const e={...shape(),fill:"#FFFFFF",points:[point(0,0),point(100,0),point(50,0)]};
  assert.equal(pointInElementFill(point(20,1),e),false);assert.equal(frameCoordinates(point(20,1),e.points),null);
  assert.equal(frameCoordinates(point(NaN,0),shape().points),null);assert.equal(frameCoordinates(point(0,0),[]),null);
});

test("fill deltas transfer only changed objects and a late acknowledgement cannot reverse Undo", async () => {
  const h=setup(),before=h.getSnapshot(1);const replica=new AnnotationReplica(async()=>h.getSnapshot(1),()=>{});
  replica.reset(1);await replica.receive({kind:"snapshot",document:before});edit(h,["rectangle"],"#ABCDEF");
  const after=h.getSnapshot(1),delta=createAnnotationUpdate(before,after);
  assert.equal(delta.kind,"delta");assert.equal(delta.inserted.length,1);assert.deepEqual(delta.removedIds,["rectangle"]);
  h.undo();const undo=h.getSnapshot(1);await replica.receive(createAnnotationUpdate(after,undo));await replica.receive(delta);
  assert.deepEqual(replica.document,undo);
});

test("settings admit only a boolean fill toggle and sanitized solid fill color", () => {
  const defaults=normalizeOverlaySettings({});assert.equal(defaults.annotationShapeFillEnabled,false);assert.equal(defaults.annotationShapeFillColor,"#FFFFFF");
  const settings=normalizeOverlaySettings({...DEFAULT_OVERLAY_SETTINGS,annotationShapeFillEnabled:true,annotationShapeFillColor:"#24A148"});
  assert.equal(settings.annotationShapeFillEnabled,true);assert.equal(settings.annotationShapeFillColor,"#24A148");
  for(const invalid of ["url(x)",null,{},"rgb(300,0,0)"]) assert.equal(normalizeOverlaySettings({annotationShapeFillColor:invalid}).annotationShapeFillColor,"#FFFFFF");
  assert.equal(normalizeOverlaySettings({annotationShapeFillEnabled:"yes"}).annotationShapeFillEnabled,false);
});
''')
write('src/electron/testing/fill-smoke.ts', r'''
import assert from "node:assert/strict";
import type { BrowserWindow } from "electron";
import type { AnnotationHistory, ShapeElement } from "../../annotation/history.js";
import { framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand, AnnotationState, AnnotationTool } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows, showMainWindow } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  state(): AnnotationState;
}

/** Native fill toggle, authoring, interior selection, grouped style edits and erasing. */
export async function verifyShapeFill(context: Context, displayId: number) {
  const candidate = mainWindow;
  const overlay = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
  if (!candidate || !overlay) throw new Error("Missing fill test windows");
  const controller = candidate;
  const state = () => context.history.getSnapshot(displayId);
  const query = (source: string) => overlay.webContents.executeJavaScript(source);
  const count = async () => Number(await query("document.querySelector('[data-annotation-selection-count]')?.dataset.annotationSelectionCount"));
  const ready = async () => waitFor(async () => Number(await query("document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision")) === state().revision,
    5000, "fill revision reaches renderer");
  const click = async (target: BrowserWindow, selector: string) => {
    const p = await target.webContents.executeJavaScript(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e || e.disabled) return null;
      e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if (!p) throw new Error("Unavailable fill control: " + selector);
    const b=target.getContentBounds(); await injectWindowsClick(b.x+p.x,b.y+p.y);
  };
  const activate = async (tool: AnnotationTool) => {
    showMainWindow(); await click(controller, '[data-mini-cast-tab="annotation"]');
    await waitFor(async () => Boolean(await controller.webContents.executeJavaScript(`Boolean(document.querySelector('[data-annotation-tool="${tool}"]'))`)),5000,"fill tool button visible");
    await click(controller, `[data-annotation-tool="${tool}"]`);
    await waitFor(()=>context.state().tool===tool,5000,"native fill tool change");
    controller.hide();
  };
  const toggle = async (enabled: boolean) => {
    showMainWindow(); await click(controller,'[data-mini-cast-tab="annotation"]');
    const checked=await controller.webContents.executeJavaScript("document.querySelector('[data-annotation-shape-fill]').checked");
    if(checked!==enabled) await click(controller,'[data-annotation-shape-fill]');
    await waitFor(async()=>await controller.webContents.executeJavaScript(`miniCast.getSettings().then(s=>s.annotationShapeFillEnabled===${enabled})`),5000,"fill setting accepted");
    controller.hide();
  };
  const pixel = async (x: number,y: number, index=0): Promise<number[]> => query(`(() => {
    const c=document.querySelectorAll('canvas')[${index}]; if(!c)return [];
    const r=c.width/c.clientWidth;return [...c.getContext('2d',{willReadFrequently:true}).getImageData(Math.round(${x}*r),Math.round(${y}*r),1,1).data];
  })()`);
  const expectPixel = async (p: {x: number;y: number}, expected: number[]) => waitFor(
    async()=>JSON.stringify(await pixel(p.x,p.y))===JSON.stringify(expected),5000,"committed fill pixels settle");
  const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).concat(255);
  const at = (element: ShapeElement) => framePoint(element.points,.5,.5);
  const viewport=state().viewport;if(!viewport)throw new Error("Missing fill viewport");
  const b=overlay.getContentBounds();
  const a={x:Math.round(viewport.width*.15),y:Math.round(viewport.height*.2)};
  const z={x:Math.round(viewport.width*.43),y:Math.round(viewport.height*.4)};
  const a2={x:Math.round(viewport.width*.60),y:a.y};
  const z2={x:Math.round(viewport.width*.86),y:z.y};
  context.history.clearDisplay(displayId);context.publishDocument(displayId);await ready();
  await activate("rectangle");await toggle(true);
  const settings=await controller.webContents.executeJavaScript("miniCast.getSettings()");
  const color=settings.annotationShapeFillColor;
  try {
    await injectWindowsMouseButton(b.x+a.x,b.y+a.y,true);
    await injectWindowsMouseMove(b.x+z.x,b.y+z.y);
    const p={x:(a.x+z.x)/2,y:(a.y+z.y)/2};
    await waitFor(async()=>JSON.stringify(await pixel(p.x,p.y,1))===JSON.stringify(rgb(color)),5000,"filled rectangle preview actually paints its interior");
  } finally { await injectWindowsMouseButton(b.x+z.x,b.y+z.y,false); }
  await waitFor(()=>state().elements.length===1,5000,"filled rectangle commits");await ready();
  const rectangle=state().elements[0] as ShapeElement;assert.equal(rectangle.fill,color);
  await expectPixel(at(rectangle),rgb(color));
  await toggle(false);assert.equal((state().elements[0] as ShapeElement).fill,color);
  await activate("ellipse");await injectWindowsDrag(b.x+a2.x,b.y+a2.y,b.x+z2.x,b.y+z2.y);
  await waitFor(()=>state().elements.length===2,5000,"hollow ellipse commits");await ready();
  const ellipse=state().elements[1] as ShapeElement;assert.equal(ellipse.fill,undefined);
  await expectPixel(at(ellipse),[0,0,0,0]);
  await activate("select");await injectWindowsClick(b.x+at(rectangle).x,b.y+at(rectangle).y);
  await waitFor(async()=>await count()===1,5000,"filled interior can be selected");
  const edge=framePoint(ellipse.points,1,.5);
  await injectWindowsDrag(b.x+edge.x,b.y+edge.y,b.x+edge.x,b.y+edge.y,["Shift"]);
  await waitFor(async()=>await count()===2,5000,"native Shift adds the hollow ellipse edge");
  const before=state();await click(overlay,"[data-selection-fill]");
  await waitFor(()=>state().revision===before.revision+1,5000,"group fill is one edit");await ready();
  const filled=state();for(const e of filled.elements as readonly ShapeElement[]) assert.equal(e.fill,color);
  await expectPixel(at(ellipse),rgb(color));
  await click(overlay,"[data-selection-fill]");
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(state().revision,filled.revision);
  await click(overlay,"[data-selection-unfill]");
  await waitFor(()=>state().revision===filled.revision+1,5000,"group unfill is one edit");await ready();
  for(const e of state().elements)assert.equal("fill" in e,false);
  await expectPixel(at(rectangle),[0,0,0,0]);await expectPixel(at(ellipse),[0,0,0,0]);
  const unfilled=state();await context.command("undo");
  await waitFor(()=>state().revision===unfilled.revision+1,5000,"unfill Undo restores the group");await ready();assert.deepEqual(state().elements,filled.elements);
  await context.command("redo");await waitFor(()=>state().revision===unfilled.revision+2,5000,"unfill Redo restores outlines");await ready();assert.deepEqual(state().elements,unfilled.elements);
  await context.command("undo");await waitFor(()=>state().revision===unfilled.revision+3,5000,"fill group restored for erasing");await ready();
  await click(overlay,"[data-selection-clear]");
  await waitFor(async()=>Boolean(await query("document.querySelector('[data-selection-fill]')?.disabled")),5000,"empty selection cannot fill");
  await activate("eraser");
  for(const target of [rectangle,ellipse]) {
    const original=state(),p=at(target);await injectWindowsClick(b.x+p.x,b.y+p.y);
    await waitFor(()=>state().revision===original.revision+1,5000,"eraser hits filled interior without touching the outline");
    assert.equal(state().elements.some(e=>e.id===target.id),false);
    await context.command("undo");await waitFor(()=>state().revision===original.revision+2,5000,"filled erase Undo");await ready();assert.deepEqual(state().elements,original.elements);
  }
  await activate("select");
  const saved=state();const loaded=new Promise<void>(resolve=>overlay.webContents.once("did-finish-load",()=>resolve()));overlay.webContents.reload();await loaded;await ready();
  assert.deepEqual(state(),saved);await expectPixel(at(ellipse),rgb(color));
  const stale=await query(`(async()=>{
    const id=crypto.randomUUID();miniCast.beginAnnotationGesture(id);
    try{return await miniCast.editAnnotationSelection(id,{kind:'fill',revision:${saved.revision-1},ids:[${JSON.stringify(rectangle.id)}],fill:null});}
    finally{miniCast.endAnnotationGesture(id);}
  })()`);
  assert.equal(stale.accepted,false);assert.equal(stale.reason,"stale-document");assert.deepEqual(state(),saved);
  await injectWindowsShortcut("Escape");
  return { rectangle:true, ellipse:true, preview:true, settingsIsolation:true, interiorSelection:true, groupFill:true,
    unfill:true, undoRedo:true, noOp:true, interiorErase:true, reload:true, staleRevision:true, emptyDisabled:true };
}
''')

replace('src/electron/testing/rendering-smoke.ts', "        elements = []; compare('mixed-clear');", r'''        for (const tool of ['rectangle','ellipse']) {
          const outline = {id:'filled-' + tool,tool,color:'#123456',width:3,opacity:1,
            points:shapeControlPoints(tool,{x:25,y:20},{x:75,y:60})};
          const filled = fillAnnotationElement(outline,'#24A148');
          elements=[outline];compare('hollow-' + tool);
          let p=a.getImageData(Math.round(50*ratio),Math.round(40*ratio),1,1).data;
          if(p[3]!==0)throw new Error('Hollow interior unexpectedly painted');
          elements=[filled];compare('solid-fill-' + tool);
          p=a.getImageData(Math.round(50*ratio),Math.round(40*ratio),1,1).data;
          if(p[0]!==36||p[1]!==161||p[2]!==72||p[3]!==255)throw new Error('Solid fill center has the wrong RGBA');
          elements=[fillAnnotationElement(filled,null)];compare('remove-fill-' + tool);
          p=a.getImageData(Math.round(50*ratio),Math.round(40*ratio),1,1).data;
          if(p[3]!==0)throw new Error('Removed fill leaves interior pixels');
          for(const angle of [0,0.63,Math.PI/2]) {
            let e=rotateAnnotationElement(filled,{x:50,y:40},angle);
            e=resizeAnnotationElement(e,{x:50,y:40},1.3,0.7);
            for(const axis of ['horizontal','vertical']) {
              const reflected=flipAnnotationElement(e,{x:50,y:40},axis);
              elements=[reflected];compare('filled-affine-' + tool + '-' + angle + '-' + axis);
              p=a.getImageData(Math.round(50*ratio),Math.round(40*ratio),1,1).data;
              if(p[3]!==255)throw new Error('Affine filled center disappeared');
              elements=[bottom,reflected,top];compare('filled-overlapping-alpha-' + tool);
              elements=[bottom,fillAnnotationElement(reflected,'#FABC12'),top];compare('recolor-filled-' + tool);
              elements=[bottom,top];compare('erase-filled-' + tool);
              elements=[bottom,reflected,top];compare('undo-filled-' + tool);
            }
          }
        }
        elements = []; compare('mixed-clear');''')
replace('src/electron/testing/interaction-smoke.ts', 'import { verifySelectionFlip }', 'import { verifyShapeFill } from "./fill-smoke.js";\nimport { verifySelectionFlip }')
replace('src/electron/testing/interaction-smoke.ts', '''    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();''', '''      diagnostics.fillTools = await verifyShapeFill({
        history: annotationHistory, publishDocument: context.publishDocument, command: shortcutCommand, state: context.state,
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();''')
replace('scripts/verify-source.ps1', "if (-not $payload.diagnostics.textEditingTools.save) { throw 'Existing-text editing was not verified.' }", "if (-not $payload.diagnostics.textEditingTools.save) { throw 'Existing-text editing was not verified.' }\nif (-not $payload.diagnostics.fillTools.interiorErase) { throw 'Shape-fill authoring/editing was not verified.' }")
replace('scripts/verify-diagnostics.ps1', '  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"', '''  foreach ($name in @('rectangle','ellipse','preview','settingsIsolation','interiorSelection','groupFill','unfill','undoRedo','noOp','interiorErase','reload','staleRevision','emptyDisabled')) {
    if (-not $result.diagnostics.fillTools.$name) { throw "Missing fill verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')

doc = 'docs/ANNOTATION-TOOLS.md'
replace(doc, '현재 문서 기준은 0.9.0입니다.', '현재 문서 기준은 0.10.0입니다.')
replace(doc, '## 이력·취소·동기화', '''## 사각형·타원 채우기 (0.10.0)

컨트롤러에서 ‘새 사각형·타원 내부 채우기’를 켜고 채우기 색상을 정한 뒤 그립니다. 윤곽선 색상·굵기와 내부 색상은 독립적입니다. 기본값은 채우기 없음이며, 설정 변경은 이미 그린 객체를 바꾸지 않습니다. 이번 채우기는 불투명 단색이며 그라데이션·별도 채우기 투명도·열린 선 채우기는 지원하지 않습니다.

기존 도형은 선택 후 하단 ‘채우기 적용’ 또는 ‘채우기 제거’를 사용합니다. 사각형·타원만으로 구성된 그룹에 한 번에 적용하고, 펜·텍스트·직선 등 다른 객체가 포함되면 버튼을 비활성화합니다. 전체 그룹이 하나의 Undo 이력이며 같은 색상을 다시 적용하거나 이미 빈 도형의 채우기를 제거하는 조작은 revision·Redo를 바꾸지 않습니다.

채워진 도형은 내부에서도 선택·요소 지우개를 사용할 수 있습니다. 빈 도형은 윤곽선만 대상으로 하며, 타원의 빈 모서리나 회전·기울어짐 뒤의 바깥 경계 상자는 채워진 내부로 취급하지 않습니다. 이동·크기 조절·회전·반전·viewport 변경·동기화·Undo/Redo에서 채우기 속성을 보존합니다.

## 이력·취소·동기화''')
replace(doc, '채우기, 레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.', '레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.')
replace(doc, '- 요소 지우개는 닿은 객체 전체를 지웁니다. 빈 사각형·타원의 내부가 아니라 외곽선을 검사합니다.', '- 요소 지우개는 닿은 객체 전체를 지웁니다. 빈 사각형·타원은 외곽선만, 채워진 도형은 내부도 검사합니다.')
with Path('docs/CHANGELOG.md').open('a', encoding='utf-8') as file:
    file.write('''\n\n## 0.10.0 — 사각형·타원 채우기

- 새 도형의 단색 내부 채우기와 기존 선택 그룹의 채우기 적용·제거를 같은 문서/변형 이력에 통합합니다.
- 윤곽선·ID·좌표·겹침 순서를 보존하고 동일 스타일은 이력과 Redo를 바꾸지 않습니다.
- 채워진 affine 도형의 내부 선택·지우개, 부분 재그리기와 설정 분리를 검사합니다.
- 단위·실제 Windows 입력·독립 내부 픽셀 판정은 해당 실행 로그가 성공 근거입니다.
''')
package['version'] = '0.10.0'
lock_path=Path('package-lock.json')
lock=json.loads(lock_path.read_text(encoding='utf-8'))
lock['version']='0.10.0'
lock['packages']['']['version']='0.10.0'
lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
subprocess.run(['git','add','package-lock.json'],check=True)
package['scripts']['check'] = check
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print('SHAPE_FILL_PREPARATION_COMPLETE version=0.10.0; full checks and fill diagnostics are mandatory')
