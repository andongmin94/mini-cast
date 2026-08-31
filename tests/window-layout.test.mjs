import assert from "node:assert/strict";
import test from "node:test";

import { fitWindowToWorkAreas } from "../dist/electron/window-layout.js";

const areas = [
  { id: 1, x: 0, y: 0, width: 1920, height: 1040 },
  { id: 2, x: -1280, y: 100, width: 1280, height: 984 },
];

test("a visible controller remains on its current monitor", () => {
  assert.deepEqual(
    fitWindowToWorkAreas(
      { x: -1000, y: 300, width: 416, height: 420 },
      areas,
      1,
    ),
    { x: -1000, y: 300, width: 416, height: 420 },
  );
});

test("an off-screen controller is centered on the primary work area", () => {
  assert.deepEqual(
    fitWindowToWorkAreas(
      { x: 5000, y: 5000, width: 416, height: 420 },
      areas,
      1,
    ),
    { x: 752, y: 310, width: 416, height: 420 },
  );
});

test("oversized windows are clamped and fitted", () => {
  assert.deepEqual(
    fitWindowToWorkAreas(
      { x: -2000, y: -500, width: 2000, height: 1200 },
      [areas[1]],
      2,
    ),
    { x: -1280, y: 100, width: 1280, height: 984 },
  );
});
