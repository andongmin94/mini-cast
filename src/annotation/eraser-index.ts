import { segmentToSegmentDistanceSquared } from "./geometry.js";
import {
  elementInkBounds,
  pointInElementFill,
  elementInkPaths,
  textOutline,
  ellipseFlatteningTolerance,
} from "./shape-geometry.js";
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

interface PreparedPath {
  readonly points: readonly AnnotationPoint[];
  readonly blocks: readonly SegmentBlock[];
}

export interface PreparedEraserElement {
  readonly stroke: AnnotationElement;
  readonly bounds: Bounds | null;
  paths: readonly PreparedPath[] | null;
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

function preparePaths(
  outlines: readonly (readonly AnnotationPoint[])[],
  aggregateBounds?: Bounds,
): readonly PreparedPath[] {
  return outlines.map(points => {
    const blocks: SegmentBlock[] = [];
    if (aggregateBounds) include(aggregateBounds, points[0]);
    for (let first = 1;first < points.length;first += SEGMENTS_PER_BLOCK) {
      const end = Math.min(first + SEGMENTS_PER_BLOCK, points.length);
      const blockBounds = pointBounds(points[first - 1]);
      for (let i = first;i < end;i++) {
        include(blockBounds, points[i]);
        if (aggregateBounds) include(aggregateBounds, points[i]);
      }
      blocks.push({ bounds: blockBounds, firstSegment: first, endSegment: end });
    }
    return { points, blocks };
  });
}

function ellipseOutlineBounds(stroke: AnnotationElement): Bounds {
  const bounds = elementInkBounds(stroke);
  const inset = stroke.tool === "ellipse" ? stroke.width / 2 : 0;
  return {
    minX: bounds.minX + inset,
    minY: bounds.minY + inset,
    maxX: bounds.maxX - inset,
    maxY: bounds.maxY - inset,
  };
}

function pathsFor(prepared: PreparedEraserElement) {
  if (prepared.paths) return prepared.paths;
  const paths = preparePaths(elementInkPaths(prepared.stroke));
  prepared.paths = paths;
  return paths;
}

/** Build linear/text geometry once per gesture; ellipse paths stay lazy until a broad-phase hit. */
export function prepareEraserElement(stroke: AnnotationElement): PreparedEraserElement {
  if (!stroke.points.length) return { stroke, bounds: null, paths: [], tolerance: 0, filled: false };
  const filled = stroke.tool === "text" || ((stroke.tool === "rectangle" || stroke.tool === "ellipse") && stroke.fill !== undefined);
  const tolerance = stroke.tool === "text" ? 0 : stroke.width / 2 + ellipseFlatteningTolerance(stroke);
  if (stroke.tool === "ellipse") {
    return { stroke, bounds: ellipseOutlineBounds(stroke), paths: null, filled, tolerance };
  }
  const outlines = stroke.tool === "text" ? [textOutline(stroke)] : elementInkPaths(stroke);
  const bounds = pointBounds(outlines[0][0]);
  return { stroke, bounds, paths: preparePaths(outlines, bounds), filled, tolerance };
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
  const { bounds, filled } = prepared;
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
  if (filled && (pointInElementFill(start, prepared.stroke) || pointInElementFill(end, prepared.stroke))) return true;
  for (const { points, blocks } of pathsFor(prepared)) {
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
