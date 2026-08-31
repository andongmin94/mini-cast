import assert from "node:assert/strict";
import test from "node:test";

import { orderDisplays } from "../dist/electron/display-order.js";

function display(id, x, y) {
  return {
    id,
    bounds: { x, y, width: 100, height: 100 },
    workArea: { x, y, width: 100, height: 90 },
    size: { width: 100, height: 100 },
    workAreaSize: { width: 100, height: 90 },
    scaleFactor: 1,
    rotation: 0,
    touchSupport: "unknown",
    monochrome: false,
    colorDepth: 24,
    depthPerComponent: 8,
    displayFrequency: 60,
    colorSpace: "srgb",
    internal: false,
    label: "",
    maximumCursorSize: { width: 0, height: 0 },
    nativeOrigin: { x, y },
    detected: true,
  };
}

test("primary display stays first and remaining work areas sort geometrically", () => {
  const ordered = orderDisplays(
    [display(3, 0, 100), display(1, 0, 0), display(2, -100, 0)],
    3,
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    [3, 2, 1],
  );
});
