import assert from "node:assert/strict";
import { globalShortcut } from "electron";
import type { AnnotationHistory, TextElement } from "../../annotation/history.js";
import { textControlPoints, framePoint } from "../../annotation/primitive-frame.js";
import type { AnnotationCommand } from "../../shared/contract.js";
import { ACTIVE_COMMAND_SHORTCUTS } from "../annotation-shortcuts.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  publishDocument(displayId: number): void;
  command(command: AnnotationCommand): Promise<void>;
  activateSelection(): Promise<void>;
}

/** Real selection/editor buttons and Ctrl+Enter; insertText supplies Unicode, not a physical IME. */
export async function verifyExistingTextEditing(context: Context, displayId: number) {
  const candidateController = mainWindow;
  const index = overlayDisplays.findIndex(display => display.id === displayId);
  const overlay = overlayWindows[index];
  if (!candidateController || !overlay) throw new Error("Missing text editor test windows");
  const controller = candidateController;
  const { history } = context;
  const state = () => history.getSnapshot(displayId);
  const query = (source: string) => controller.webContents.executeJavaScript(source);
  const overlayQuery = (source: string) => overlay.webContents.executeJavaScript(source);
  const ready = async () => waitFor(async () => Number(await overlayQuery(
    `document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision`)) === state().revision,
    5000, "text revision reaches overlay");
  const clickElement = async (selection: string, inController: boolean) => {
    const target = inController ? controller : overlay;
    const encoded = JSON.stringify(selection);
    const position = await target.webContents.executeJavaScript(`(() => {
      const node = document.querySelector(${encoded}); if (!node || node.disabled) return null;
      node.scrollIntoView({block:'nearest'}); const r = node.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if (!position) throw new Error("Unavailable text editing button: " + selection);
    const bounds = target.getContentBounds();
    await injectWindowsClick(Math.round(bounds.x + position.x), Math.round(bounds.y + position.y));
  };
  await context.activateSelection();
  history.clearDisplay(displayId);
  history.addElement(displayId, { id: "edit-text", tool: "text", text: "기존 제목", fontSize: 24,
    color: "#123456", opacity: 1, points: textControlPoints({ x: 120, y: 120 }),
    box: { minX: 0, minY: 0, maxX: 110, maxY: 34 } });
  history.rotateElements(displayId, ["edit-text"], { x: 120, y: 120 }, Math.PI / 6);
  history.resizeElements(displayId, ["edit-text"], { x: 120, y: 120 }, 1.3, 0.8);
  context.publishDocument(displayId); await ready();
  const original = state();
  async function openEditor() {
    controller.hide();
    const element = state().elements.find(item => item.id === "edit-text") as TextElement;
    const point = framePoint(element.points, (element.box.minX + element.box.maxX) / 2, (element.box.minY + element.box.maxY) / 2);
    const bounds = overlay.getContentBounds();
    await injectWindowsClick(Math.round(bounds.x + point.x), Math.round(bounds.y + point.y));
    await waitFor(async () => Boolean(await overlayQuery(`document.querySelector('[data-selection-text-edit]:not(:disabled)')`)),
      5000, "one text enables re-edit");
    await clickElement("[data-selection-text-edit]", false);
    await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-existing-text-editor] textarea') === document.activeElement`)),
      5000, "controller re-edit autofocus");
    await waitFor(() => ACTIVE_COMMAND_SHORTCUTS.every(shortcut => !globalShortcut.isRegistered(shortcut.accelerator)),
      5000, "text editing releases document shortcuts");
  }
  async function setText(value: string) {
    await query(`(() => { const field = document.querySelector('[data-annotation-existing-text-editor] textarea'); field.focus(); field.select(); })()`);
    await controller.webContents.insertText(value);
    await waitFor(async () => await query(`document.querySelector('[data-annotation-existing-text-editor] textarea')?.value`) === value,
      5000, "Unicode replacement reaches controlled textarea");
  }
  async function closed() {
    await waitFor(async () => !await query(`Boolean(document.querySelector('[data-annotation-existing-text-editor]'))`), 5000, "editor closes");
    await ready();
  }
  await openEditor();
  const oldValue = await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`);
  assert.equal(oldValue, "기존 제목");
  await setText("임시 문자열");
  await injectWindowsShortcut("Ctrl+Z");
  await waitFor(async () => await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`) !== "임시 문자열", 5000, "editor-local Undo");
  assert.equal(state().revision, original.revision);
  const content = "수정된 제목" + String.fromCharCode(10) + "둘째 줄 ABC";
  await setText(content);
  await injectWindowsShortcut("Ctrl+Enter"); await closed();
  const edited = state();
  const editedText = edited.elements[0] as TextElement;
  assert.equal(editedText.text, content); assert.deepEqual(editedText.points, original.elements[0].points);
  assert.equal(editedText.color, original.elements[0].color); assert.equal(editedText.id, "edit-text");
  assert.equal(edited.revision, original.revision + 1);
  await context.command("undo"); await ready(); assert.deepEqual(state().elements, original.elements);
  await context.command("redo"); await ready(); assert.deepEqual(state().elements, edited.elements);

  await openEditor();
  const noOpRevision = state().revision;
  await injectWindowsShortcut("Ctrl+Enter"); await closed();
  assert.equal(state().revision, noOpRevision, "Identical text made an edit");

  const beforeCancel = state();
  await openEditor(); await setText("취소할 내용");
  await injectWindowsShortcut("Escape"); await closed();
  assert.deepEqual(state(), beforeCancel);

  await openEditor(); await setText("오래된 편집");
  history.translateElements(displayId, ["edit-text"], 7, 0); context.publishDocument(displayId); await ready();
  const external = state();
  await injectWindowsShortcut("Ctrl+Enter");
  await waitFor(async () => Boolean(await query(`document.querySelector('[data-annotation-existing-text-editor] [role="status"]')?.textContent`)),
    5000, "stale text edit notice");
  assert.deepEqual(state(), external);
  assert.equal(await query(`document.querySelector('[data-annotation-existing-text-editor] textarea').value`), "오래된 편집");
  await clickElement("[data-annotation-text-cancel]", true); await closed();

  await openEditor(); await setText("재로딩 중 초안");
  const loaded = new Promise<void>(resolve => controller.webContents.once("did-finish-load", () => resolve()));
  controller.webContents.reload(); await loaded;
  await waitFor(async () => Boolean(await query(`document.getElementById('root')?.childElementCount`)), 5000, "controller reload");
  assert.equal(await query(`Boolean(document.querySelector('[data-annotation-existing-text-editor]'))`), false);
  assert.equal(await query(`miniCast.getAnnotationTextEdit()`), null);
  assert.deepEqual(state(), external);

  const unauthorized = await overlayQuery(`miniCast.saveAnnotationTextEdit('not-a-controller', {})`);
  assert.equal(unauthorized.accepted, false); assert.deepEqual(state(), external);
  return { open: true, save: true, affinePreserved: true, undoRedo: true, editorUndo: true,
    noOp: true, cancel: true, staleRevision: true, controllerReload: true, senderRejected: true };
}
