import assert from "node:assert/strict";
import test from "node:test";

import {
  ELLIPSE_FLATTENING_ERROR,
  MAX_ELLIPSE_FLATTENING_SEGMENTS,
  elementInkPaths,
} from "../../../dist/annotation/shape-geometry.js";

function ellipse(extent) {
  return {
    id: "ellipse",
    tool: "ellipse",
    color: "#FF0000",
    opacity: 1,
    width: 4,
    points: [
      { x: 0, y: 0 },
      { x: extent, y: 0 },
      { x: 0, y: extent },
    ],
  };
}

test("normal ellipses retain the existing flattening tolerance", () => {
  const element = ellipse(1000);
  const [a, b, c] = element.points;
  const radiusBound = Math.hypot(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y) / 2;
  const requested = Math.max(
    16,
    Math.ceil(Math.PI * Math.sqrt(radiusBound / (2 * ELLIPSE_FLATTENING_ERROR))),
  );
  assert.ok(requested < MAX_ELLIPSE_FLATTENING_SEGMENTS);
  assert.equal(elementInkPaths(element)[0].length, requested + 1);
});

test("pathological ellipse frames cannot allocate unbounded derived paths", () => {
  const points = elementInkPaths(ellipse(1_000_000))[0];
  assert.equal(points.length, MAX_ELLIPSE_FLATTENING_SEGMENTS + 1);
  assert.deepEqual(points[0], points.at(-1));
});
