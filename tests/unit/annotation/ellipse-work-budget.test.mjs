import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ANNOTATION_ELEMENTS_PER_DISPLAY,
  MAX_ANNOTATION_POINTS_PER_DISPLAY,
  annotationElementCost,
  copyAnnotationElements,
} from "../../../dist/annotation/history.js";

function ellipse(id, extent = 1_000_000) {
  return {
    id,
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

test("ellipse document cost conservatively covers renderer flattening work", () => {
  const element = ellipse("ellipse-large");
  const [origin, xEnd, yEnd] = element.points;
  const radiusBound = Math.hypot(
    xEnd.x - origin.x,
    xEnd.y - origin.y,
    yEnd.x - origin.x,
    yEnd.y - origin.y,
  ) / 2;
  const rendererPoints = Math.max(
    16,
    Math.ceil(Math.PI * Math.sqrt(radiusBound / (2 * 0.125))),
  ) + 1;
  assert.ok(annotationElementCost(element) >= rendererPoints);
  assert.ok(annotationElementCost(element) > element.points.length);
});

test("many cheap-on-disk huge ellipses are rejected by the shared document budget", () => {
  const sample = ellipse("sample");
  const cost = annotationElementCost(sample);
  const count = Math.floor(MAX_ANNOTATION_POINTS_PER_DISPLAY / cost) + 1;
  assert.ok(count < MAX_ANNOTATION_ELEMENTS_PER_DISPLAY);

  const elements = Array.from({ length: count }, (_, index) =>
    ellipse(`ellipse-${index}`),
  );
  assert.throws(
    () => copyAnnotationElements(elements),
    (error) => error?.reason === "point-limit",
  );
});
