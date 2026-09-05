import assert from "node:assert/strict";
import test from "node:test";

import {
  eraserSweepHitsStroke,
  pointHitsStroke,
} from "../../../dist/annotation/geometry.js";

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

test("eraser hit testing handles single-point elements", () => {
  const dot = { ...stroke, points: [{ x: 10, y: 10 }] };
  assert.equal(pointHitsStroke({ x: 13, y: 10 }, dot, 1), true);
  assert.equal(pointHitsStroke({ x: 14, y: 10 }, dot, 1), false);
});

test("eraser sweep catches a stroke between sparse pointer samples", () => {
  assert.equal(
    eraserSweepHitsStroke(
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      stroke,
      1,
    ),
    true,
  );
  assert.equal(
    eraserSweepHitsStroke(
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      stroke,
      1,
    ),
    false,
  );
});

test("eraser sweep handles dots and collinear segments", () => {
  const dot = { ...stroke, points: [{ x: 20, y: 10 }] };
  assert.equal(
    eraserSweepHitsStroke({ x: 0, y: 10 }, { x: 40, y: 10 }, dot, 0),
    true,
  );
  assert.equal(
    eraserSweepHitsStroke(
      { x: 0, y: 10 },
      { x: 40, y: 10 },
      stroke,
      0,
    ),
    true,
  );
});
