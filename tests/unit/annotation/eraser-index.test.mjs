import assert from "node:assert/strict";
import test from "node:test";
import { eraserSweepHitsStroke } from "../../../dist/annotation/geometry.js";
import {
  prepareEraserStroke,
  eraserSweepHitsPreparedStroke,
} from "../../../dist/annotation/eraser-index.js";

const stroke = (points, width = 4, id = "s") => ({
  id,
  tool: "pen",
  color: "#000000",
  width,
  opacity: 1,
  points,
});
const hits = (points, start, end, radius, width = 4) =>
  eraserSweepHitsPreparedStroke(
    start,
    end,
    prepareEraserStroke(stroke(points, width)),
    radius,
  );
const counters = () => ({
  strokeBoundsTests: 0,
  blockBoundsTests: 0,
  segmentTests: 0,
});

test("prepared erasing handles empty strokes, dots and repeated points", () => {
  const p = { x: -20, y: 30 };
  assert.equal(hits([], p, p, 1), false);
  assert.equal(hits([p], p, p, 0), true);
  assert.equal(hits([p, p, p], p, p, 0), true);
  assert.equal(hits([p], { x: -50, y: 30 }, { x: 50, y: 30 }, 0), true);
  assert.equal(hits([p], { x: -20, y: 40 }, { x: -20, y: 40 }, 0), false);
});

test("conservative bounds retain exact tangencies, stroke width and sparse sweeps", () => {
  const points = [
    { x: 0, y: -100 },
    { x: 0, y: 100 },
  ];
  assert.equal(hits(points, { x: -200, y: 0 }, { x: 200, y: 0 }, 0), true);
  assert.equal(hits(points, { x: 10, y: 0 }, { x: 10, y: 0 }, 8), true);
  assert.equal(
    hits(points, { x: 10.001, y: 0 }, { x: 10.001, y: 0 }, 8),
    false,
  );
  assert.equal(hits(points, { x: -50, y: 110 }, { x: 50, y: 110 }, 8), true);
  assert.equal(
    hits(points, { x: -50, y: 110.001 }, { x: 50, y: 110.001 }, 8),
    false,
  );
});

test("segments crossing block boundaries are never omitted", () => {
  const points = Array.from({ length: 131 }, (_, i) => ({ x: i, y: 0 }));
  for (const x of [0, 31.5, 32, 32.5, 63.5, 64, 95.5, 96, 128, 129.9, 130]) {
    const start = { x, y: -10 };
    const end = { x, y: 10 };
    assert.equal(hits(points, start, end, 0, 0.5), true, `x=${x}`);
  }
});

test("wide-stroke and negative-coordinate queries agree with exact reference geometry", () => {
  const points = [
    { x: -500, y: -400 },
    { x: -100, y: -300 },
    { x: 200, y: -800 },
  ];
  const source = stroke(points, 128);
  const prepared = prepareEraserStroke(source);
  for (let x = -600; x <= 300; x += 17) {
    const a = { x, y: -500 };
    const b = { x: x + 4, y: -250 };
    for (const radius of [-1, 0, 14, 40]) {
      assert.equal(
        eraserSweepHitsPreparedStroke(a, b, prepared, radius),
        eraserSweepHitsStroke(a, b, source, radius),
      );
    }
  }
});

test("seeded randomized sweeps exactly match the original exhaustive kernel", () => {
  let seed = 0x32f0aa17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const coordinate = () => (random() - 0.5) * 2000;
  for (let trial = 0; trial < 3000; trial += 1) {
    const count = 1 + Math.floor(random() * 140);
    const origin = { x: coordinate(), y: coordinate() };
    const points = Array.from({ length: count }, (_, i) =>
      i % 11 === 0
        ? { ...origin }
        : { x: origin.x + random() * 60, y: origin.y + random() * 60 },
    );
    const source = stroke(points, 0.5 + random() * 127.5);
    const prepared = prepareEraserStroke(source);
    const a =
      trial % 3 === 0 ? { ...origin } : { x: coordinate(), y: coordinate() };
    const b = trial % 5 === 0 ? { ...a } : { x: coordinate(), y: coordinate() };
    const radius = random() * 40;
    assert.equal(
      eraserSweepHitsPreparedStroke(a, b, prepared, radius),
      eraserSweepHitsStroke(a, b, source, radius),
      `trial=${trial}`,
    );
  }
});

test("a local query avoids almost all exact segment tests in a 128k-point document", () => {
  const sources = Array.from({ length: 1000 }, (_, row) =>
    stroke(
      Array.from({ length: 128 }, (_, x) => ({ x, y: row * 4 })),
      2,
      `s-${row}`,
    ),
  );
  const a = { x: 64, y: 2000 };
  const stats = counters();
  const actual = sources
    .map(prepareEraserStroke)
    .filter((p) => eraserSweepHitsPreparedStroke(a, a, p, 1, stats))
    .map((p) => p.stroke.id);
  const expected = sources
    .filter((s) => eraserSweepHitsStroke(a, a, s, 1))
    .map((s) => s.id);
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual, ["s-500"]);
  assert.equal(stats.strokeBoundsTests, 1000);
  assert.ok(stats.segmentTests <= 64, JSON.stringify(stats));
  console.log(
    "Eraser local-query work:",
    JSON.stringify({
      documentPoints: 128000,
      exhaustiveSegmentUpperBound: 127000,
      ...stats,
    }),
  );
});

test("segment-block bounds also accelerate a single long stroke", () => {
  const points = Array.from({ length: 10000 }, (_, x) => ({ x, y: 0 }));
  const prepared = prepareEraserStroke(stroke(points, 1));
  const stats = counters();
  const a = { x: 8000, y: -2 };
  const b = { x: 8000, y: 2 };
  assert.equal(eraserSweepHitsPreparedStroke(a, b, prepared, 0, stats), true);
  assert.ok(stats.segmentTests <= 64, JSON.stringify(stats));
  assert.ok(stats.blockBoundsTests < 313);
});
