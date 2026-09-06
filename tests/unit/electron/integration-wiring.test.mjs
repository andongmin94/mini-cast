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
test("normal exit uses the coordinator and the tray does not prepare windows before requesting quit", async () => {
  assert.match(await text("src/electron/main.ts"), /quitCoordinator\.beforeQuit\(event\)/);
  const window = await text("src/electron/window.ts");
  assert.match(window, /export function quitApplication\(\) \{\s*app\.quit\(\);\s*\}/);
});
test("viewport invalidation finishes native input before resizing either canvas", async () => {
  const source = await text("src/renderer/components/AnnotationSurface.tsx");
  assert.match(source, /observeAnnotationViewport\(committed, \(\) => \{\s*finishGestureState\(true\);\s*resizeCanvas\(committed\)/);
});
