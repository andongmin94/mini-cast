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
