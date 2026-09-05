import assert from "node:assert/strict";
import test from "node:test";
import { TransientInk, transientInkOpacity, TRANSIENT_HOLD_MS, TRANSIENT_FADE_MS,
  MAX_TRANSIENT_STROKES, MAX_TRANSIENT_POINTS_PER_STROKE, MAX_TRANSIENT_POINTS } from "../../../dist/annotation/transient-ink.js";
import { AnnotationHistory, isAnnotationElement } from "../../../dist/annotation/history.js";
import { isAnnotationTool, isTransientAnnotationTool } from "../../../dist/shared/contract.js";
const point = (x = 0, y = 0) => ({ x, y });
const begin = (ink, now = 0) => ink.begin(point(), "#FF0000", 4, now);

test("temporary tools are valid UI modes but never permanent element types", () => {
  for (const tool of ["laser", "fading-ink"]) {
    assert.equal(isAnnotationTool(tool), true); assert.equal(isTransientAnnotationTool(tool), true);
    assert.equal(isAnnotationElement({id:"t",tool,points:[point()],color:"#FF0000",width:4,opacity:1}), false);
  }
  for (const tool of ["pen", "highlighter", "select", null, {}, "laser-fallback"]) assert.equal(isTransientAnnotationTool(tool), false);
});
test("fading starts at release and uses elapsed time rather than frame count", () => {
  const ink = new TransientInk(); begin(ink);
  assert.equal(ink.frame(100000)[0].opacity, 1);
  ink.finish(100000);
  assert.equal(ink.frame(100000 + TRANSIENT_HOLD_MS)[0].opacity, 1);
  assert.equal(ink.frame(100000 + TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS / 2)[0].opacity, 0.5);
  assert.deepEqual(ink.frame(100000 + TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS), []);
  assert.equal(ink.pointCount, 0); assert.equal(ink.animating, false);
});
test("each completed stroke has its own lifetime and active input remains visible", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(0); begin(ink, 500); ink.finish(500); begin(ink, 600);
  assert.deepEqual(ink.frame(2700).map(x => x.opacity), [5/7, 1]);
  assert.equal(ink.strokeCount, 2); ink.cancel(); assert.equal(ink.strokeCount, 1);
});
test("a suspended animation purges expired data on the next frame", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(10);
  assert.deepEqual(ink.frame(3600000), []); assert.equal(ink.pointCount, 0); assert.equal(ink.strokeCount, 0);
});
test("static active ink does not need a continuous animation loop", () => {
  const ink = new TransientInk(); begin(ink); assert.equal(ink.animating, false);
  ink.finish(10); assert.equal(ink.animating, true); ink.frame(3000); assert.equal(ink.animating, false);
});
test("samples are copied and subpixel duplicates do not inflate the point buffer", () => {
  const ink = new TransientInk(), input = point(10, 20); ink.begin(input,"#123456",8,0); input.x = 99;
  assert.equal(ink.frame(0)[0].points[0].x,10); assert.equal(ink.append(point(10.1,20.1),0),true);
  assert.equal(ink.pointCount,1); ink.append(point(11,20),1); assert.equal(ink.pointCount,2);
  assert.throws(() => begin(ink)); assert.equal(ink.pointCount,2);
});
test("per-stroke limits explicitly stop collection and keep the captured prefix", () => {
  const ink = new TransientInk(); begin(ink);
  for (let i=1;i<MAX_TRANSIENT_POINTS_PER_STROKE;i++) assert.equal(ink.append(point(i,0),0),true);
  assert.equal(ink.append(point(10000,0),0),false); assert.equal(ink.pointCount,MAX_TRANSIENT_POINTS_PER_STROKE);
  assert.equal(ink.finish(1),true); assert.equal(ink.finish(1),false);
});
test("completed transient strokes are bounded and oldest disposable traces expire first", () => {
  const ink = new TransientInk();
  for (let i=0;i<100;i++) { ink.begin(point(i,0),"#FF0000",4,0); ink.finish(0); }
  assert.equal(ink.strokeCount,MAX_TRANSIENT_STROKES); assert.equal(ink.frame(0)[0].points[0].x,68);
});
test("the total point budget is enforced across large overlapping temporary strokes", () => {
  const ink = new TransientInk();
  for (let s=0;s<20;s++) { begin(ink); for(let p=1;p<MAX_TRANSIENT_POINTS_PER_STROKE;p++) ink.append(point(p,s),0); ink.finish(0);
    assert.ok(ink.pointCount<=MAX_TRANSIENT_POINTS); }
  assert.ok(ink.frame(0).every(x=>x.opacity===1)); ink.clear(); assert.equal(ink.pointCount,0);
});
test("cancellation drops only the active gesture, while explicit clear drops all temporary state", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(0); begin(ink,1); ink.cancel();
  assert.equal(ink.strokeCount,1); assert.equal(ink.drawing,false); ink.clear(); ink.clear();
  assert.equal(ink.strokeCount,0); assert.equal(ink.animating,false); assert.equal(ink.append(point(),3),false);
});
test("invalid clocks, coordinates and styles are rejected before collecting input", () => {
  const ink = new TransientInk();
  for (const now of [NaN, Infinity, -1]) assert.throws(()=>begin(ink,now));
  for (const p of [point(NaN),point(Infinity),point(1000001),null]) assert.throws(()=>ink.begin(p,"#FF0000",4,0));
  for (const width of [NaN,Infinity,0,129]) assert.throws(()=>ink.begin(point(),"#FF0000",width,0));
  for (const color of ["url(x)","red","#123","#FFFFFF00"]) assert.throws(()=>ink.begin(point(),color,4,0));
  assert.equal(ink.pointCount,0); assert.equal(transientInkOpacity(100,50),1);
});
test("transient lifecycle cannot mutate a retained permanent document or its Redo", () => {
  const history = new AnnotationHistory();
  history.addElement(1,{id:"saved",tool:"pen",color:"#FF0000",width:4,opacity:1,points:[point()]});
  history.addElement(1,{id:"redo",tool:"pen",color:"#FF0000",width:4,opacity:1,points:[point(10,10)]}); history.undo();
  const before = history.getSnapshot(1); const ink = new TransientInk();
  for (let i=0;i<500;i++) { begin(ink,i); ink.append(point(i+1,20),i); if(i%3) ink.finish(i); else ink.cancel(); ink.frame(i+50); }
  ink.clear(); assert.strictEqual(history.getSnapshot(1),before); assert.equal(history.canRedo,true);
});
