import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory, rotateAnnotationElement, resizeAnnotationElement, isAnnotationElement } from "../../../dist/annotation/history.js";
import { annotationSelectionBounds, applyAnnotationSelectionEdit, rotateSelectionElements, readAnnotationSelectionEdit } from "../../../dist/annotation/selection.js";
import { normalizeRotation, rotatePoint, selectionRotationAngle, selectionRotationCenter, rotationHandlePoint } from "../../../dist/annotation/rotation.js";
import { shapeControlPoints, textControlPoints, framePoint, frameCorners, pointInFrame } from "../../../dist/annotation/primitive-frame.js";
import { elementInkBounds, elementInkPaths } from "../../../dist/annotation/shape-geometry.js";
import { pointHitsStroke, eraserSweepHitsStroke } from "../../../dist/annotation/geometry.js";
import { prepareEraserElement, eraserSweepHitsPreparedElement } from "../../../dist/annotation/eraser-index.js";
import { AnnotationReplica, createAnnotationUpdate, reduceAnnotationUpdate } from "../../../dist/annotation/document-sync.js";

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const pointClose = (a,b) => { close(a.x,b.x); close(a.y,b.y); };
const point = (x,y) => ({x,y});
const make = (tool, id = tool) => tool === "text"
  ? {id,tool,color:"#123456",opacity:1,points:textControlPoints(point(100,80)),text:"한글 ABC\nrotation",fontSize:28,box:{minX:-2,minY:0,maxX:120,maxY:70}}
  : {id,tool,color:"#123456",opacity:tool === "highlighter" ? 0.35 : 1,width:4,
    points:shapeControlPoints(tool,point(30,40),point(150,100))};
const tools = ["pen","highlighter","line","arrow","rectangle","ellipse","text"];
function setup() { const h = new AnnotationHistory(); h.setDisplayViewport(1,800,600); for (const t of tools) h.addElement(1,make(t)); return h; }
function edit(h, ids, radians, revision = h.getSnapshot(1).revision) { return applyAnnotationSelectionEdit(h,1,{kind:"rotate",revision,ids,radians}); }

test("rotation canonicalizes full turns and makes exact quarter turns", () => {
  for (const a of [0,2*Math.PI,-2*Math.PI]) assert.equal(normalizeRotation(a),0);
  assert.deepEqual(rotatePoint(point(30,20),point(10,10),Math.PI/2),point(0,30));
  let p = point(30,20); for(let i=0;i<4;i++) p=rotatePoint(p,point(10,10),Math.PI/2);
  assert.deepEqual(p,point(30,20));
  for(const a of [NaN,Infinity,-Infinity,20]) assert.throws(()=>normalizeRotation(a));
});

test("rotation drag has no initial jump, wraps angles and snaps to 15 degrees", () => {
  const c=point(100,100), start=point(106,60);
  assert.equal(selectionRotationAngle(c,start,start,true),0);
  const end=rotatePoint(start,c,0.48);
  close(selectionRotationAngle(c,start,end,false),0.48);
  close(selectionRotationAngle(c,start,end,true),Math.PI/6);
  assert.equal(selectionRotationAngle(c,start,c,false),null);
  const a=point(100+40*Math.cos(3.1),100+40*Math.sin(3.1));
  const b=point(100+40*Math.cos(-3.1),100+40*Math.sin(-3.1));
  close(selectionRotationAngle(c,a,b,false),2*Math.PI-6.2);
});

test("rotation handles fit tiny, edge and offscreen selections without changing the pivot", () => {
  for(const box of [{minX:0,minY:0,maxX:1,maxY:1},{minX:790,minY:590,maxX:800,maxY:600},
    {minX:-100,minY:-100,maxX:900,maxY:700},{minX:300,minY:200,maxX:500,maxY:300}]) {
    const before={...box}, c=selectionRotationCenter(box), p=rotationHandlePoint(box,{width:800,height:600});
    assert.ok(p.x>=10&&p.x<=790&&p.y>=10&&p.y<=590);
    assert.deepEqual(box,before); assert.deepEqual(selectionRotationCenter(box),c);
  }
});

for(const tool of tools) test(`${tool} rotation keeps preview, commit, exact Undo and Redo consistent`, () => {
  const h=new AnnotationHistory();h.addElement(1,make(tool)); const before=h.getSnapshot(1);
  const preview=rotateSelectionElements(before.elements,new Set([tool]),Math.PI/5);
  edit(h,[tool],Math.PI/5);const after=h.getSnapshot(1);
  assert.deepEqual(after.elements,preview);assert.equal(after.revision,before.revision+1);
  assert.ok(Object.isFrozen(after.elements[0].points[0])); assert.equal(after.elements[0].id,tool);
  assert.equal(after.elements[0].color,before.elements[0].color);
  assert.equal(after.elements[0].opacity,before.elements[0].opacity);
  if(tool!=="text") assert.equal(after.elements[0].width,before.elements[0].width);
  else {assert.equal(after.elements[0].text,before.elements[0].text);assert.deepEqual(after.elements[0].box,before.elements[0].box);}
  h.undo();assert.deepEqual(h.getSnapshot(1).elements,before.elements);
  h.redo();assert.deepEqual(h.getSnapshot(1).elements,after.elements);
});

test("a mixed group rotates around one authoritative pivot without touching unrelated elements", () => {
  const h=setup(),before=h.getSnapshot(1),ids=["rectangle","text","pen"];
  const pivot=selectionRotationCenter(annotationSelectionBounds(before.elements,new Set(ids)));
  edit(h,ids,Math.PI/2);const after=h.getSnapshot(1);
  assert.deepEqual(after.elements.map(e=>e.id),before.elements.map(e=>e.id));
  before.elements.forEach((e,i)=>{
    if(!ids.includes(e.id)) assert.strictEqual(after.elements[i],e);
    else assert.deepEqual(after.elements[i].points,e.points.map(p=>rotatePoint(p,pivot,Math.PI/2)));
  });
  h.undo();assert.deepEqual(h.getSnapshot(1).elements,before.elements);
});

test("rotation followed by anisotropic resizing preserves full affine primitive geometry", () => {
  for(const tool of ["rectangle","ellipse","text"]) {
    const e=make(tool),pivot=point(50,60),anchor=point(10,20);
    const rotated=rotateAnnotationElement(e,pivot,Math.PI/4);
    const next=resizeAnnotationElement(rotated,anchor,2,0.5);
    assert.equal(isAnnotationElement(next),true);
    for(const [u,v] of [[0,0],[1,0],[0,1],[0.5,0.5],[0.2,0.8]]) {
      const p=rotatePoint(framePoint(e.points,u,v),pivot,Math.PI/4);
      pointClose(framePoint(next.points,u,v),point(anchor.x+(p.x-anchor.x)*2,anchor.y+(p.y-anchor.y)*0.5));
    }
  }
});

test("rotated text hits its actual affine layout, not the empty corners of the AABB", () => {
  const e=rotateAnnotationElement(make("text"),point(100,80),Math.PI/4),box=elementInkBounds(e);
  const inside=framePoint(e.points,30,20),outside=point(box.minX+0.1,box.minY+0.1);
  assert.equal(pointInFrame(inside,e.points,e.box),true);assert.equal(pointInFrame(outside,e.points,e.box),false);
  assert.equal(pointHitsStroke(inside,e,0),true);assert.equal(pointHitsStroke(outside,e,0),false);
  const prepared=prepareEraserElement(e);
  assert.equal(eraserSweepHitsPreparedElement(outside,outside,prepared,0),false);
  assert.equal(eraserSweepHitsPreparedElement(inside,inside,prepared,0),true);
});

test("affine ellipse bounds analytically enclose the entire rotated and sheared outline", () => {
  const e=resizeAnnotationElement(rotateAnnotationElement(make("ellipse"),point(100,100),0.63),point(0,0),2,0.7);
  const box=elementInkBounds(e);
  for(let i=0;i<4096;i++) {
    const angle=2*Math.PI*i/4096,p=framePoint(e.points,(1+Math.cos(angle))/2,(1+Math.sin(angle))/2);
    assert.ok(p.x>=box.minX&&p.x<=box.maxX&&p.y>=box.minY&&p.y<=box.maxY);
  }
  const corners=frameCorners(rotateAnnotationElement(make("rectangle"),point(90,70),Math.PI/2).points);
  assert.equal(corners.length,4);close(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y),120);
});

test("rotated primitive eraser broad phase agrees with exhaustive world-space paths", () => {
  let seed=17;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(const tool of tools) for(let i=0;i<80;i++) {
    const e=rotateAnnotationElement(make(tool),point(100,100),(rand()-0.5)*2*Math.PI),a=point(rand()*250,rand()*200),b=point(rand()*250,rand()*200),radius=rand()*8;
    assert.equal(eraserSweepHitsPreparedElement(a,b,prepareEraserElement(e),radius),eraserSweepHitsStroke(a,b,e,radius));
    if(tool!=="text") assert.ok(elementInkPaths(e).length);
  }
});

test("rotation requests reject stale revisions, duplicate IDs and invalid angles atomically", () => {
  const h=setup(),before=h.getSnapshot(1);
  for(const value of [{kind:"rotate",revision:before.revision,ids:["pen"],radians:NaN},
    {kind:"rotate",revision:before.revision,ids:["pen"],radians:8},
    {kind:"rotate",revision:before.revision,ids:["pen","pen"],radians:1}]) {
    assert.equal(readAnnotationSelectionEdit(value),null);assert.throws(()=>applyAnnotationSelectionEdit(h,1,value));
    assert.strictEqual(h.getSnapshot(1),before);
  }
  assert.throws(()=>edit(h,["pen"],1,before.revision-1),e=>e.reason==="stale-document");
  assert.throws(()=>edit(h,["pen","missing"],1),e=>e.reason==="stale-document");
  assert.strictEqual(h.getSnapshot(1),before);
});

test("full-turn and zero rotation preserve cached snapshots, history and Redo", () => {
  const h=setup();h.undo();const before=h.getSnapshot(1);
  for(const angle of [0,2*Math.PI,-2*Math.PI]) {
    assert.equal(edit(h,["pen"],angle),null);assert.strictEqual(h.getSnapshot(1),before);assert.equal(h.canRedo,true);
    assert.strictEqual(rotateSelectionElements(before.elements,new Set(["pen"]),angle),before.elements);
  }
});

test("one overflowing member rejects the whole group with no partial geometry mutation", () => {
  const h=setup();h.addElement(1,{...make("pen","edge"),points:[point(1000000,1000000)]});const before=h.getSnapshot(1);
  assert.throws(()=>h.rotateElements(1,["pen","edge"],point(-1000000,-1000000),Math.PI/4));
  assert.strictEqual(h.getSnapshot(1),before);
});

test("rotations stay coherent with global history, viewport changes and checkpoints", () => {
  const h=setup();h.addElement(2,make("pen","other"));const before=h.getSnapshot(1);
  edit(h,["rectangle","text"],0.7);const checkpoint=h.clone();h.setDisplayViewport(1,1200,300);
  const resized=h.getSnapshot(1);h.undo();
  before.elements.forEach((e,i)=>e.points.forEach((p,j)=>pointClose(h.getSnapshot(1).elements[i].points[j],point(p.x*1.5,p.y*0.5))));
  h.redo();assert.deepEqual(h.getSnapshot(1).elements,resized.elements);
  h.restoreFrom(checkpoint);assert.equal(h.undo(),1);assert.equal(h.undo(),2);
});

test("rotation delta only carries changed objects and late replies cannot resurrect an Undo", async () => {
  const h=setup(),before=h.getSnapshot(1),replica=new AnnotationReplica(async()=>h.getSnapshot(1),()=>{});
  replica.reset(1);await replica.receive({kind:"snapshot",document:before});edit(h,["text"],0.5);
  const after=h.getSnapshot(1),delta=createAnnotationUpdate(before,after);
  assert.equal(delta.kind,"delta");assert.equal(delta.inserted.length,1);assert.deepEqual(delta.removedIds,["text"]);
  assert.deepEqual(reduceAnnotationUpdate(before,1,delta).document,after);
  h.undo();const undone=h.getSnapshot(1);await replica.receive(createAnnotationUpdate(after,undone));await replica.receive(delta);
  assert.deepEqual(replica.document,undone);
});

test("four group quarter turns return exact coordinates without re-identifying any element", () => {
  const h=setup(),before=h.getSnapshot(1),ids=tools;
  for(let i=0;i<4;i++) edit(h,ids,Math.PI/2);
  before.elements.forEach((e,i)=>e.points.forEach((p,j)=>pointClose(h.getSnapshot(1).elements[i].points[j],p)));
  assert.deepEqual(h.getSnapshot(1).elements.map(e=>e.id),ids);
});
