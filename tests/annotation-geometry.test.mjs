import assert from "node:assert/strict";
import test from "node:test";

import { pointHitsStroke } from "../dist/annotation/geometry.js";

const stroke = {
  id: "stroke",
  tool: "pen",
  points: [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
  ],
  color: "#000000",
  width: 4,
  opacity: 1,
};

test("eraser hit testing includes stroke thickness", () => {
  assert.equal(pointHitsStroke({ x: 20, y: 15 }, stroke, 3), true);
  assert.equal(pointHitsStroke({ x: 20, y: 16 }, stroke, 3), false);
});

test("eraser hit testing handles single-point strokes", () => {
  const dot = { ...stroke, points: [{ x: 10, y: 10 }] };
  assert.equal(pointHitsStroke({ x: 13, y: 10 }, dot, 1), true);
  assert.equal(pointHitsStroke({ x: 14, y: 10 }, dot, 1), false);
});
