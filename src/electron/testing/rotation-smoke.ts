import assert from "node:assert/strict";
import { screen } from "electron";
import type { AnnotationHistory, AnnotationElement } from "../../annotation/history.js";
import { annotationSelectionBounds, rotateSelectionElements } from "../../annotation/selection.js";
import { rotatePoint, selectionRotationAngle, selectionRotationCenter } from "../../annotation/rotation.js";
import { shapeControlPoints, textControlPoints, framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand, AnnotationState } from "../../shared/contract.js";
import { overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface RotationSmokeContext {
  history: AnnotationHistory;
  publishDocument(id: number): void;
  command(command: AnnotationCommand): Promise<void>;
  state(): AnnotationState;
  activateSelection(): Promise<void>;
}

/** Fixtures use domain calls; edits use native Windows input and the real UI. */
export async function verifySelectionRotation(context: RotationSmokeContext, displayId: number) {
  await context.activateSelection();
  const { history } = context;
  const target = overlayWindows[overlayDisplays.findIndex(d => d.id === displayId)];
  const display = screen.getAllDisplays().find(d => d.id === displayId);
  if (!target || !display) throw new Error("Missing rotation test surface");
  const query = (source: string) => target.webContents.executeJavaScript(source);
  const snapshot = () => history.getSnapshot(displayId);
  const screenPoint = (p: { x: number; y: number }) => ({ x: Math.round(display.bounds.x + p.x), y: Math.round(display.bounds.y + p.y) });
  const local = (p: { x: number; y: number }) => ({ x: p.x - display.bounds.x, y: p.y - display.bounds.y });
  const ready = async () => waitFor(async () => {
    const s = await query(`({ revision:Number(document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision), busy:document.querySelector('[data-annotation-selection-busy]')?.dataset.annotationSelectionBusy })`);
    return s.revision === snapshot().revision && s.busy === "false";
  }, 5000, "rotation transaction settled");
  const count = async (n: number) => waitFor(async () => Number(await query(`document.querySelector('[data-annotation-selection-count]')?.dataset.annotationSelectionCount`)) === n, 5000, "rotation selection count");
  const handle = async () => {
    let p: { x: number; y: number } | null = null;
    await waitFor(async () => {
      p = await query(`(() => {const n=document.querySelector('[data-selection-rotate]'); if(!n||n.disabled)return null; const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      return p !== null;
    }, 5000, "rotation handle visible");
    return screenPoint(p!);
  };
  const expect = async (elements: readonly AnnotationElement[], label: string) => {
    await waitFor(() => JSON.stringify(snapshot().elements) === JSON.stringify(elements), 5000, label);
    await ready();
  };
  history.clearDisplay(displayId);
  history.addElement(displayId, { id:"rotate-box", tool:"rectangle",color:"#007AFF",opacity:1,width:4,
    points:shapeControlPoints("rectangle",{x:100,y:110},{x:260,y:190}) });
  history.addElement(displayId, { id:"rotate-text",tool:"text",color:"#123456",opacity:1,fontSize:24,
    text:"회전 ABC",points:textControlPoints({x:310,y:150}),box:{minX:0,minY:0,maxX:115,maxY:34} });
  context.publishDocument(displayId); await ready();
  const click=screenPoint({x:180,y:110}); await injectWindowsClick(click.x,click.y);await count(1);
  const before=snapshot(),p=await handle();
  await injectWindowsClick(p.x,p.y);await ready();assert.equal(snapshot().revision,before.revision,"rotation handle click created history");
  const center=selectionRotationCenter(annotationSelectionBounds(before.elements,new Set(["rotate-box"]))!);
  const end=screenPoint(rotatePoint(local(p),center,0.63));
  const angle=selectionRotationAngle(center,local(p),local(end),false)!;
  const expected=rotateSelectionElements(before.elements,new Set(["rotate-box"]),angle);
  await injectWindowsDrag(p.x,p.y,end.x,end.y);await expect(expected,"native rotation exact geometry");
  assert.equal(snapshot().revision,before.revision+1);
  const edge=framePoint(expected[0].points,0.5,0);
  await waitFor(async()=>await query(`(() => {const c=document.querySelector('canvas'),ctx=c.getContext('2d');const x=Math.round(${edge.x}*c.width/c.clientWidth),y=Math.round(${edge.y}*c.height/c.clientHeight);const a=ctx.getImageData(x-2,y-2,5,5).data;return a.some((v,i)=>i%4===3&&v>0);})()`),5000,"rotated outline pixels");
  await context.command("undo");await expect(before.elements,"rotation Undo exact restore");
  await context.command("redo");await expect(expected,"rotation Redo exact restore");
  await context.command("undo");await expect(before.elements,"reset rotation fixture");
  const text=screenPoint({x:350,y:165});await injectWindowsDrag(text.x,text.y,text.x,text.y,["Shift"]);await count(2);
  const groupBefore=snapshot(),ids=new Set(["rotate-box","rotate-text"]),gp=await handle();
  const gc=selectionRotationCenter(annotationSelectionBounds(groupBefore.elements,ids)!);
  const ge=screenPoint(rotatePoint(local(gp),gc,0.58));
  const ga=selectionRotationAngle(gc,local(gp),local(ge),true)!;
  const groupAfter=rotateSelectionElements(groupBefore.elements,ids,ga);
  await injectWindowsDrag(gp.x,gp.y,ge.x,ge.y,["Shift"]);await expect(groupAfter,"native Shift group rotation");
  assert.ok(Math.abs(ga/(Math.PI/12)-Math.round(ga/(Math.PI/12)))<1e-8);
  await context.command("undo");await expect(groupBefore.elements,"single Undo restores both rotated objects");
  await context.command("redo");await expect(groupAfter,"group rotation Redo");
  const cancellation=snapshot(),cp=await handle();
  await query(`(() => {const c=document.querySelector('canvas');window.__rotationPixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;})()`);
  try {
    await injectWindowsMouseButton(cp.x,cp.y,true);await injectWindowsMouseMove(cp.x+25,cp.y+20);
    await waitFor(async()=>await query(`Boolean(document.querySelector('[data-active-gesture="rotate"]'))`),5000,"held rotation");
    await context.command("undo");
    await waitFor(async()=>!(await query(`Boolean(document.querySelector('[data-active-gesture]'))`)),5000,"held rotation cancelled");
    assert.equal(snapshot().revision,cancellation.revision);
    await waitFor(async()=>await query(`(() => {const c=document.querySelector('canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=window.__rotationPixels;return a.length===b.length&&a.every((v,i)=>v===b[i]);})()`),5000,"rotation cancellation pixel restore");
  } finally {await injectWindowsMouseButton(cp.x+25,cp.y+20,false);await query("delete window.__rotationPixels");}
  const rejected=await query(`(async()=>{const s=await miniCast.getAnnotationDocument(),id=crypto.randomUUID();miniCast.beginAnnotationGesture(id);try{return await miniCast.editAnnotationSelection(id,{kind:'rotate',revision:s.revision-1,ids:['rotate-box','rotate-text'],radians:1});}finally{miniCast.endAnnotationGesture(id);}})()`);
  assert.equal(rejected.accepted,false);assert.equal(rejected.reason,"stale-document");assert.deepEqual(snapshot(),cancellation);
  const rp=await handle();
  try {
    await injectWindowsMouseButton(rp.x,rp.y,true);await injectWindowsMouseMove(rp.x+18,rp.y+18);
    await waitFor(async()=>await query(`Boolean(document.querySelector('[data-active-gesture="rotate"]'))`),5000,"rotation before reload");
    const loaded=new Promise<void>(resolve=>target.webContents.once("did-finish-load",()=>resolve()));target.webContents.reload();await loaded;
  } finally {await injectWindowsMouseButton(rp.x+18,rp.y+18,false);}
  await ready();await count(0);assert.deepEqual(snapshot(),cancellation);
  // Re-select an actual point on the rotated rectangle rather than its AABB interior.
  const reclick=screenPoint(framePoint(snapshot().elements[0].points,0.5,0));
  await injectWindowsClick(reclick.x,reclick.y);await count(1);const ep=await handle();
  try {
    await injectWindowsMouseButton(ep.x,ep.y,true);await injectWindowsMouseMove(ep.x+20,ep.y+20);
    await injectWindowsShortcut("Escape");await waitFor(()=>context.state().tool==="pass-through",5000,"Escape leaves rotation");
  } finally {await injectWindowsMouseButton(ep.x+20,ep.y+20,false);}
  assert.deepEqual(snapshot(),cancellation);
  return {handle:true,noOp:true,rotate:true,groupShift:true,undoRedo:true,pixels:true,heldUndo:true,staleRevision:true,activeReload:true,heldEscape:true};
}
