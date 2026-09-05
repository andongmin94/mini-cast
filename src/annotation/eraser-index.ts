import { pointInFrame } from "./primitive-frame.js";
import { segmentToSegmentDistanceSquared } from "./geometry.js";
import { elementInkPaths, textOutline, ELLIPSE_FLATTENING_ERROR } from "./shape-geometry.js";
import type { AnnotationPoint, AnnotationElement } from "./history.js";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SegmentBlock {
  bounds: Bounds;
  firstSegment: number;
  endSegment: number;
}

export interface PreparedEraserElement {
  readonly stroke: AnnotationElement;
  readonly bounds: Bounds | null;
  readonly paths: readonly { points: readonly AnnotationPoint[]; blocks: readonly SegmentBlock[] }[];
  readonly tolerance: number;
  readonly filled: boolean;
}

/** Optional counters measure work, not wall-clock latency. */
export interface EraserQueryStats {
  strokeBoundsTests: number;
  blockBoundsTests: number;
  segmentTests: number;
}

const SEGMENTS_PER_BLOCK = 32;
const BOUNDS_EPSILON = 1e-9;

function pointBounds(point: AnnotationPoint): Bounds {
  return { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
}

function include(bounds: Bounds, point: AnnotationPoint) {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

/** Build once per gesture; all committed elements are immutable. */
export function prepareEraserElement(stroke: AnnotationElement): PreparedEraserElement {
  if (!stroke.points.length) return { stroke, bounds: null, paths: [], tolerance: 0, filled: false };
  const filled = stroke.tool === "text";
  const outlines = stroke.tool === "text" ? [textOutline(stroke)] : elementInkPaths(stroke);
  const bounds = pointBounds(outlines[0][0]);
  const paths = outlines.map(points => {
    const blocks: SegmentBlock[] = [];
    include(bounds, points[0]);
    for (let first = 1;first < points.length;first += SEGMENTS_PER_BLOCK) {
      const end = Math.min(first + SEGMENTS_PER_BLOCK, points.length);
      const blockBounds = pointBounds(points[first - 1]);
      for (let i = first;i < end;i++) { include(blockBounds, points[i]); include(bounds, points[i]); }
      blocks.push({ bounds: blockBounds, firstSegment: first, endSegment: end });
    }
    return { points, blocks };
  });
  return { stroke, bounds, paths, filled, tolerance: stroke.tool === "text" ? 0 : stroke.width / 2 + (stroke.tool === "ellipse" ? ELLIPSE_FLATTENING_ERROR : 0) };
}

function overlaps(left: Bounds, right: Bounds) {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

/** Broad-phase bounds only reject impossible hits; the existing exact kernel decides hits. */
export function eraserSweepHitsPreparedElement(
  start: AnnotationPoint,
  end: AnnotationPoint,
  prepared: PreparedEraserElement,
  eraserRadius: number,
  stats?: EraserQueryStats,
) {
  const { bounds, paths, filled } = prepared;
  if (!bounds) return false;
  const tolerance = Math.max(0, eraserRadius) + prepared.tolerance;
  const padding = tolerance + BOUNDS_EPSILON;
  const query = {
    minX: Math.min(start.x, end.x) - padding,
    minY: Math.min(start.y, end.y) - padding,
    maxX: Math.max(start.x, end.x) + padding,
    maxY: Math.max(start.y, end.y) + padding,
  };
  if (stats) stats.strokeBoundsTests += 1;
  if (!overlaps(bounds, query)) return false;
  const toleranceSquared = tolerance * tolerance;
  if (filled && prepared.stroke.tool === "text" && (pointInFrame(start, prepared.stroke.points, prepared.stroke.box) || pointInFrame(end, prepared.stroke.points, prepared.stroke.box))) return true;
  for (const { points, blocks } of paths) {
    if (points.length === 1) {
      if (stats) stats.segmentTests++;
      if (segmentToSegmentDistanceSquared(start, end, points[0], points[0]) <= toleranceSquared) return true;
    }
    for (const block of blocks) {
      if (stats) stats.blockBoundsTests++;
      if (!overlaps(block.bounds, query)) continue;
      for (let index = block.firstSegment;index < block.endSegment;index++) {
        if (stats) stats.segmentTests++;
        if (segmentToSegmentDistanceSquared(start, end, points[index - 1], points[index]) <= toleranceSquared) return true;
      }
    }
  }
  return false;
}
