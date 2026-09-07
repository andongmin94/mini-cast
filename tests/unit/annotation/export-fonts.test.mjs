import assert from "node:assert/strict";
import test from "node:test";

import { loadAnnotationExportFonts } from "../../../dist/annotation/export-renderer.js";

function snapshot(elements) {
  return {
    displayId: 1,
    revision: 1,
    viewport: { width: 100, height: 80 },
    elements,
  };
}

const text = {
  id: "text-1",
  tool: "text",
  color: "#FFFFFF",
  opacity: 1,
  points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  text: "한글 ABC",
  fontSize: 28,
  box: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
};

test("annotation export fails when the requested bundled font has no loaded face", async () => {
  const document = {
    fonts: {
      load: async () => [],
    },
  };
  await assert.rejects(
    () => loadAnnotationExportFonts(document, snapshot([text])),
    (error) => error?.reason === "render-failed",
  );
});

test("annotation export accepts loaded text fonts and skips font work for ink-only documents", async () => {
  let calls = 0;
  const document = {
    fonts: {
      load: async () => {
        calls += 1;
        return [{}];
      },
    },
  };
  await loadAnnotationExportFonts(document, snapshot([text]));
  assert.equal(calls, 1);

  await loadAnnotationExportFonts(document, snapshot([
    { id: "ink", tool: "pen", color: "#FF0000", opacity: 1, width: 4, points: [{ x: 1, y: 1 }] },
  ]));
  assert.equal(calls, 1);
});
