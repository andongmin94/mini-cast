import assert from "node:assert/strict";
import type { AnnotationHistory } from "../../annotation/history.js";
import type { AnnotationCommand, AnnotationState, AnnotationTool } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  state(): AnnotationState;
  publishDocument(id: number): void;
  activateTool(tool: AnnotationTool): Promise<void>;
  command(command: AnnotationCommand): Promise<void>;
}

/** OS input and Canvas observations; no pointer events are synthesized in the renderer. */
export async function verifyTransientTools(context: Context, displayId: number) {
  const overlay = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
  const controller = mainWindow;
  if (!overlay || !controller) throw new Error("Transient test windows missing");
  const query = (script: string) => overlay.webContents.executeJavaScript(script);
  const history = context.history;
  const state = () => history.getSnapshot(displayId);
  const ready = async () => waitFor(async () => Number(await query(
    `document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision`)) === state().revision, 5000, "permanent document displayed");
  const at = (x: number, y: number) => { const b=overlay.getContentBounds(); return {x:Math.round(b.x+x),y:Math.round(b.y+y)}; };
  const choose = async (tool: AnnotationTool) => {
    await context.activateTool(tool);
    await waitFor(()=>context.state().tool===tool,5000,"temporary tool activated");
    controller.hide();
    if (tool === "laser" || tool === "fading-ink") await waitFor(async()=>Boolean(await query(
      `document.querySelector('[data-annotation-transient="${tool}"]')`)),5000,"temporary surface mounted");
  };
  const sample = async (x: number, y: number) => query(`(() => {
    const c=document.querySelector('[data-annotation-transient]'); if(!c)return null;
    return Array.from(c.getContext('2d').getImageData(Math.round(${x}*c.width/c.clientWidth),Math.round(${y}*c.height/c.clientHeight),1,1).data);
  })()`);
  const noTransientInk = async () => Boolean(await query(`(() => {
    const c=document.querySelector('[data-annotation-transient]'); if(!c)return true;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=3;i<d.length;i+=4)if(d[i])return false; return true;
  })()`));
  const draw = async () => { const a=at(160,220), b=at(260,220); await injectWindowsDrag(a.x,a.y,b.x,b.y); };
  const leaseEnded = async () => waitFor(()=>!context.state().canUndo,5000,"temporary gesture lease ended");

  history.clearDisplay(displayId);
  history.addElement(displayId,{id:"transient-baseline",tool:"pen",points:[{x:100,y:80},{x:300,y:80}],color:"#00A050",width:6,opacity:1});
  history.addElement(displayId,{id:"transient-redo",tool:"pen",points:[{x:100,y:110},{x:300,y:110}],color:"#00A050",width:6,opacity:1});
  history.undo(); context.publishDocument(displayId); await ready();
  const before = state();
  const unchanged = () => { assert.strictEqual(state(),before); assert.equal(history.canRedo,true); };
  await choose("fading-ink");
  assert.equal(context.state().canUndo,false); assert.equal(context.state().canRedo,false);
  await ready();
  await query(`window.__temporaryBaseline = document.querySelector('canvas').getContext('2d').getImageData(0,0,document.querySelector('canvas').width,document.querySelector('canvas').height).data`);
  await draw(); await leaseEnded();
  await waitFor(async()=> (await sample(210,220))?.[3]===255,1500,"temporary ink visible after release");
  await waitFor(async()=> { const alpha=(await sample(210,220))?.[3]; return alpha>0&&alpha<255; },4000,"temporary ink actually fades");
  await waitFor(noTransientInk,3000,"temporary pixels expire completely");
  assert.equal(await query(`document.querySelector('[data-annotation-transient]').dataset.transientPoints`),"0");
  assert.equal(await query(`document.querySelector('[data-annotation-transient]').dataset.transientAnimating`),"false"); unchanged();
  assert.equal(await query(`(() => {const c=document.querySelector('canvas'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.every((v,i)=>v===window.__temporaryBaseline[i]);})()`),true);

  await draw(); await leaseEnded(); await context.command("clear");
  await waitFor(noTransientInk,2000,"Clear removes temporary ink only"); unchanged();
  await context.command("undo"); await context.command("redo"); unchanged();

  const a=at(160,220), b=at(260,220);
  try {
    await injectWindowsMouseButton(a.x,a.y,true); await injectWindowsMouseMove(b.x,b.y);
    await waitFor(()=>context.state().canUndo,3000,"held temporary lease visible");
    await context.command("undo");
    await waitFor(async()=>!await query(`Boolean(document.querySelector('[data-active-gesture]'))`),3000,"held temporary gesture cancelled");
    await waitFor(noTransientInk,2000,"held Undo discards temporary preview"); unchanged();
  } finally { await injectWindowsMouseButton(b.x,b.y,false); }

  await draw();
  const loaded=new Promise<void>(resolve=>overlay.webContents.once("did-finish-load",()=>resolve()));
  overlay.webContents.reload(); await loaded; await ready();
  await waitFor(async()=>Boolean(await query(`document.querySelector('[data-annotation-transient="fading-ink"]')`)),5000,"temporary surface reloads");
  await waitFor(noTransientInk,2000,"reload discards temporary ink"); unchanged();

  await choose("laser"); const p=at(320,240); await injectWindowsMouseMove(p.x,p.y);
  await waitFor(async()=> { const pixel=await sample(325,240); return pixel?.[0]===255&&pixel?.[3]===255; },3000,"laser red ring tracks OS pointer");
  const q=at(430,300); await injectWindowsMouseMove(q.x,q.y);
  await waitFor(async()=> (await sample(325,240))?.[3]===0 && (await sample(435,300))?.[3]===255,3000,"laser leaves no trail");
  await injectWindowsClick(q.x,q.y); await leaseEnded(); unchanged();

  // Even a valid, leased pen payload must be rejected while a temporary tool owns input.
  const blocked=await query(`(async()=>{
    const id=crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
    try {const added=await miniCast.commitAnnotationElement(id,{id:'forbidden-temp-save',tool:'pen',color:'#FF0000',width:4,opacity:1,points:[{x:20,y:20}]});
      const erased=await miniCast.removeAnnotationElements(id,['transient-baseline']);return !added.accepted&&!erased.accepted;}
    finally {miniCast.endAnnotationGesture(id);}
  })()`); assert.equal(blocked,true); unchanged();

  await choose("fading-ink");
  try {
    await injectWindowsMouseButton(a.x,a.y,true); await injectWindowsMouseMove(b.x,b.y);
    await injectWindowsShortcut("Escape");
    await waitFor(()=>context.state().tool==="pass-through",3000,"Escape restores pass-through");
  } finally { await injectWindowsMouseButton(b.x,b.y,false); }
  await waitFor(async()=>!await query(`Boolean(document.querySelector('[data-annotation-transient]'))`),3000,"temporary layer removed on exit"); unchanged();
  await choose("pen"); assert.equal(context.state().canRedo,true);
  await context.command("redo"); await waitFor(()=>state().elements.some(item=>item.id==="transient-redo"),3000,"permanent Redo remains usable");
  await context.command("undo"); await ready(); assert.deepEqual(state().elements,before.elements);
  return { laser:true, fadingPixels:true, expiry:true, idleStopped:true, historyIsolated:true, clear:true,
    heldUndo:true, heldEscape:true, reload:true, permanentWritesRejected:true, redoPreserved:true };
}
