import assert from "node:assert/strict";
import { screen } from "electron";
import type { AnnotationHistory, AnnotationElement, AnnotationPoint } from "../../annotation/history.js";
import { flipSelectionElements } from "../../annotation/selection.js";
import { framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, waitFor } from "./smoke.js";

interface FlipSmokeContext {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  activateSelection(): Promise<void>;
}

/** Fixture construction and observation are direct; selection and flips use native input. */
export async function verifySelectionFlip(context: FlipSmokeContext, displayId: number) {
  const target = overlayWindows[overlayDisplays.findIndex(display => display.id === displayId)];
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!target || !display) throw new Error("Missing native flip surface");
  const contents = target.webContents;
  const query = (source: string) => contents.executeJavaScript(source);
  const snapshot = () => context.history.getSnapshot(displayId);
  const screenPoint = (p: AnnotationPoint) => ({ x: Math.round(display.bounds.x + p.x), y: Math.round(display.bounds.y + p.y) });
  const ready = async () => {
    await waitFor(async () => {
      const state = await query(`(() => ({ revision:Number(document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision),
        busy:document.querySelector('[data-annotation-selection-busy]')?.dataset.annotationSelectionBusy }))()`);
      return state.revision === snapshot().revision && state.busy === "false";
    }, 5000, "flip document and renderer settle");
  };
  const count = async (expected: number) => {
    await waitFor(async () => Number(await query(`document.querySelector('[data-annotation-selection-count]')?.dataset.annotationSelectionCount`)) === expected,
      5000, `${expected} selected flip objects`);
  };
  const click = async (p: AnnotationPoint, shift = false) => {
    const absolute = screenPoint(p);
    if (shift) await injectWindowsDrag(absolute.x, absolute.y, absolute.x, absolute.y, ["Shift"]);
    else await injectWindowsClick(absolute.x, absolute.y);
  };
  const clickButton = async (selector: string) => {
    const p = await query(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.disabled) throw new Error('Flip control not available');
      const r = node.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
      if (r.left<0 || r.top<0 || r.right>innerWidth || r.bottom>innerHeight || document.elementFromPoint(x,y)!==node)
        throw new Error('Flip toolbar target is clipped or obscured');
      return {x,y};
    })()`);
    await click(p);
  };
  const expectElements = async (elements: readonly AnnotationElement[], label: string) => {
    await waitFor(() => JSON.stringify(snapshot().elements) === JSON.stringify(elements), 5000, label);
    await ready();
  };
  await context.activateSelection();
  mainWindow?.setBounds({ x: display.bounds.x + Math.max(0, display.bounds.width - 426),
    y: display.bounds.y + 10, width: 416, height: 420 }, false);
  context.history.clearDisplay(displayId); context.publishDocument(displayId);
  await ready(); await count(0);
  assert.equal(await query(`Array.from(document.querySelectorAll('[data-selection-flip]')).filter(n => n.disabled).length`), 2);
  const pen: AnnotationElement = { id:"flip-pen", tool:"pen", color:"#123456", width:4, opacity:1,
    points:[{x:80,y:100},{x:190,y:110},{x:140,y:160}] };
  context.history.addElement(displayId, pen); context.publishDocument(displayId); await ready();
  await click(pen.points[0]); await count(1);
  for (const axis of ["horizontal", "vertical"] as const) {
    const before = snapshot();
    const preview = flipSelectionElements(before.elements, new Set([pen.id]), axis);
    await query(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__miniCastFlipPixels = document.querySelector('canvas').toDataURL(); resolve(true);
    })))`);
    await clickButton(`[data-selection-flip="${axis}"]`);
    await expectElements(preview, `native ${axis} flip`);
    assert.equal(snapshot().revision, before.revision + 1, "Flip must be one transaction");
    await waitFor(async () => await query(`document.querySelector('canvas').toDataURL() !== window.__miniCastFlipPixels`), 5000, "flip changes visible pixels");
    await context.command("undo"); await expectElements(before.elements, "native flip Undo");
    await waitFor(async () => await query(`document.querySelector('canvas').toDataURL() === window.__miniCastFlipPixels`), 5000, "flip Undo restores exact pixels");
    await context.command("redo"); await expectElements(preview, "native flip Redo");
    await context.command("undo"); await expectElements(before.elements, "restore before next flip");
  }
  await query("delete window.__miniCastFlipPixels");

  const elements: AnnotationElement[] = [
    { ...pen, points:[{x:80,y:70},{x:145,y:75},{x:115,y:100}] },
    { id:"flip-highlighter",tool:"highlighter",color:"#FFD60A",width:10,opacity:0.35,points:[{x:90,y:120},{x:145,y:125}] },
    { id:"flip-line",tool:"line",color:"#123456",width:4,opacity:1,points:[{x:80,y:175},{x:140,y:185}] },
    { id:"flip-arrow",tool:"arrow",color:"#123456",width:4,opacity:1,points:[{x:190,y:80},{x:270,y:100}] },
    { id:"flip-rectangle",tool:"rectangle",color:"#123456",width:4,opacity:1,points:[{x:200,y:145},{x:285,y:160},{x:185,y:210}] },
    { id:"flip-ellipse",tool:"ellipse",color:"#123456",width:4,opacity:1,points:[{x:340,y:155},{x:445,y:175},{x:320,y:225}] },
    { id:"flip-text",tool:"text",color:"#123456",opacity:1,points:[{x:90,y:260},{x:91,y:260.25},{x:89.75,y:261}],
      text:"반전 ABC",fontSize:24,box:{minX:0,minY:-2,maxX:100,maxY:36} },
  ];
  context.history.clearDisplay(displayId);
  for (const element of elements) context.history.addElement(displayId, element);
  context.publishDocument(displayId); await ready();
  await click({x:30,y:330}); await count(0);
  for (let i=0; i<elements.length; i++) {
    const element=elements[i];
    const p=element.tool === "ellipse" ? framePoint(element.points,1,0.5)
      : element.tool === "text" ? framePoint(element.points,10,10) : element.points[0];
    await click(p,i>0); await count(i+1);
  }
  const ids=new Set(elements.map(element=>element.id));
  const beforeGroup=snapshot();
  const horizontal=flipSelectionElements(beforeGroup.elements,ids,"horizontal");
  await clickButton('[data-selection-flip="horizontal"]');
  await expectElements(horizontal,"native mixed-group horizontal flip");
  assert.equal(snapshot().revision,beforeGroup.revision+1);
  const vertical=flipSelectionElements(snapshot().elements,ids,"vertical");
  await clickButton('[data-selection-flip="vertical"]');
  await expectElements(vertical,"native mixed-group vertical flip");
  await context.command("undo"); await expectElements(horizontal,"one Undo restores the complete mixed group");
  const mirrored=snapshot();
  const loaded=new Promise<void>(resolve=>contents.once("did-finish-load",()=>resolve()));
  contents.reload(); await loaded; await ready(); await count(0);
  assert.deepEqual(snapshot(),mirrored);
  const text=mirrored.elements.find(element=>element.id==="flip-text");
  if (!text || text.tool!=="text") throw new Error("Mirrored text fixture missing");
  await click(framePoint(text.points,10,10)); await count(1);
  await clickButton('[data-selection-delete]');
  await expectElements(mirrored.elements.filter(element=>element.id!==text.id),"mirrored text selection and delete");
  await context.command("undo"); await expectElements(mirrored.elements,"mirrored text delete Undo");
  const beforeStale=snapshot();
  const rejected=await query(`(async()=>{
    const id=crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
    try { return await miniCast.editAnnotationSelection(id,{kind:'flip',axis:'horizontal',ids:['flip-text'],revision:${beforeStale.revision-1}}); }
    finally { miniCast.endAnnotationGesture(id); }
  })()`);
  assert.equal(rejected.accepted,false); assert.equal(rejected.reason,"stale-document");
  assert.deepEqual(snapshot(),beforeStale);
  return { horizontal:true, vertical:true, groupShift:true, undoRedo:true, pixels:true,
    mirroredText:true, delete:true, reload:true, staleRevision:true, emptyDisabled:true };
}
