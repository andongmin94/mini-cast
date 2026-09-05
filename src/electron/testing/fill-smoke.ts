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
