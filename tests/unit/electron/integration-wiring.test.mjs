import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const text = file => readFile(new URL(`../../../${file}`, import.meta.url), "utf8");

test("file and PNG handlers share publication and lifetime policies rather than per-operation quit listeners", async () => {
  for (const file of ["src/electron/annotation-files.ts", "src/electron/annotation-export.ts"]) {
    const source = await text(file);
    assert.match(source, /lifetime\.publish\(options\.gate/);
    assert.match(source, /lifetime\.watch\(controller, \["hide", "minimize", "closed"\]\)/);
    assert.doesNotMatch(source, /before-quit|app\.quit\(/);
  }
});
test("native save handlers normalize an omitted extension before strict writers", async () => {
  for (const file of ["src/electron/annotation-files.ts", "src/electron/annotation-export.ts"]) {
    const source = await text(file);
    assert.match(source, /withDefaultExtension\(result\.filePath,/);
  }
});
test("controller push subscriptions are installed before bootstrap reads and win races", async () => {
  const source = await text("src/renderer/components/Controller.tsx");
  const before = (subscription, request) => {
    const subscriptionIndex = source.indexOf(subscription);
    const requestIndex = source.indexOf(request);
    assert.ok(subscriptionIndex >= 0 && requestIndex >= 0 && subscriptionIndex < requestIndex,
      `${subscription} must be installed before ${request}`);
  };
  before("const stopSettings = miniCast.onSettingsUpdated", ".getSettings()");
  before("const stopAnnotation = miniCast.onAnnotationStateUpdated", ".getAnnotationState()");
  before("const stopSaveStatus = miniCast.onSettingsSaveStatus", ".getSettingsSaveStatus()");
  assert.match(source, /!active \|\| settingsPushed/);
  assert.match(source, /!active \|\| annotationPushed/);
  assert.match(source, /!active \|\| saveStatusPushed/);
});
test("text input suppression runs before native fallback tool shortcuts and refreshes registrations", async () => {
  const input = await text("src/electron/input.ts");
  const suppressed = input.indexOf("if (keyboardInputSuppressed) return;");
  const fallback = input.indexOf("if (fallbackToolCombinations.has(combination))");
  assert.ok(suppressed >= 0 && fallback >= 0 && suppressed < fallback);
  const main = await text("src/electron/main.ts");
  assert.match(main, /function setControllerTextEditing[\s\S]*refreshToolShortcuts\(\);[\s\S]*refreshTransientAnnotationShortcuts\(\);/);
  assert.match(main, /function refreshToolShortcuts[\s\S]*controllerTextEditing \|\| shuttingDown/);
});
test("existing text edit sessions stay isolated when the controller loses focus", async () => {
  const main = await text("src/electron/main.ts");
  assert.match(main, /setControllerTextEditing\(value \|\| Boolean\(textEdits\.current\)\)/);
  assert.match(main, /annotation-text-edit-open[\s\S]*showMainWindow\(\);\s*setControllerTextEditing\(true\);/);
  assert.match(main, /mainWindow\?\.on\("blur", \(\) => \{\s*if \(!textEdits\.current\) setControllerTextEditing\(false\);\s*\}\);/);
});
test("text editing locks every annotation document mutation boundary", async () => {
  const main = await text("src/electron/main.ts");
  assert.match(main, /const editingText = controllerTextEditing \|\| Boolean\(textEdits\.current\);/);
  assert.match(main, /canUndo: !quitDialogOpen && !editingText/);
  assert.match(main, /canRedo: !quitDialogOpen && !editingText/);
  assert.match(main, /function setControllerTextEditing[\s\S]*if \(editing\) cancelActiveAnnotationGestures\(\);/);
  assert.match(main, /function sendAnnotationCommand[\s\S]*displayRebuildInProgress \|\| quitDialogOpen \|\| controllerTextEditing \|\| textEdits\.current/);
  assert.match(main, /annotation-gesture-begin[\s\S]*displayRebuildInProgress \|\|\s*controllerTextEditing \|\| textEdits\.current/);
  for (const handler of ["annotation-add-element", "annotation-remove-elements", "annotation-edit-selection"]) {
    const index = main.indexOf(`"${handler}"`);
    assert.ok(index >= 0, `Missing ${handler} handler`);
    const boundary = main.slice(index, index + 2200);
    assert.match(boundary, /controllerTextEditing \|\| textEdits\.current/,
      `${handler} must reject commits while text editing`);
  }
});
test("normal quit treats an active existing-text edit as unsaved work", async () => {
  const main = await text("src/electron/main.ts");
  assert.match(main, /function getUnsavedAnnotationKey\(\)[\s\S]*const documentKey = annotationSaveState\.key/);
  assert.match(main, /const edit = textEdits\.current;/);
  assert.match(main, /if \(documentKey === null && !edit\) return null;/);
  assert.match(main, /edit \? \[edit\.id, edit\.displayId, edit\.revision, edit\.element\.id\] : null/);
  assert.match(main, /const editingText = Boolean\(textEdits\.current\);/);
  assert.match(main, /적용하지 않은 텍스트 수정이 있습니다/);
  assert.match(main, /텍스트 수정을 적용하거나 취소한 뒤/);
});
test("normal exit uses the coordinator and the tray does not prepare windows before requesting quit", async () => {
  assert.match(await text("src/electron/main.ts"), /quitCoordinator\.beforeQuit\(event\)/);
  const window = await text("src/electron/window.ts");
  assert.match(window, /export function quitApplication\(\) \{\s*app\.quit\(\);\s*\}/);
});
test("viewport invalidation finishes native input before resizing either canvas", async () => {
  const source = await text("src/renderer/components/AnnotationSurface.tsx");
  assert.match(source, /observeAnnotationViewport\(committed, \(\) => \{\s*finishGestureState\(true\);\s*resizeCanvas\(committed\)/);
});

test("quit confirmation suspends board presentation and keeps emergency pass-through available", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../../../src/electron/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes('tool: quitDialogOpen ? "pass-through" : annotationTool'));
  assert.ok(main.includes('quitDialogOpen && tool !== "pass-through"'));
  assert.ok(main.includes('lifetime.watch(controller, ["hide", "minimize", "closed"])'));
});
