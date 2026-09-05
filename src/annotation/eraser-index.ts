import { segmentToSegmentDistanceSquared } from "./geometry.js";
import type { AnnotationPoint, AnnotationStroke } from "./history.js";

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

export interface PreparedEraserStroke {
  readonly stroke: AnnotationStroke;
  readonly bounds: Bounds | null;
  readonly blocks: readonly SegmentBlock[];
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

/** Build once per gesture; the source stroke must not change during the gesture. */
export function prepareEraserStroke(
  stroke: AnnotationStroke,
): PreparedEraserStroke {
  if (!stroke.points.length) return { stroke, bounds: null, blocks: [] };
  const bounds = pointBounds(stroke.points[0]);
  const blocks: SegmentBlock[] = [];
  for (
    let first = 1;
    first < stroke.points.length;
    first += SEGMENTS_PER_BLOCK
  ) {
    const end = Math.min(first + SEGMENTS_PER_BLOCK, stroke.points.length);
    const blockBounds = pointBounds(stroke.points[first - 1]);
    for (let index = first; index < end; index += 1) {
      const point = stroke.points[index];
      include(blockBounds, point);
      include(bounds, point);
    }
    blocks.push({ bounds: blockBounds, firstSegment: first, endSegment: end });
  }
  return { stroke, bounds, blocks };
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
export function eraserSweepHitsPreparedStroke(
  start: AnnotationPoint,
  end: AnnotationPoint,
  prepared: PreparedEraserStroke,
  eraserRadius: number,
  stats?: EraserQueryStats,
) {
  const { stroke, bounds, blocks } = prepared;
  if (!bounds) return false;
  const tolerance = Math.max(0, eraserRadius) + stroke.width / 2;
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
  if (stroke.points.length === 1) {
    if (stats) stats.segmentTests += 1;
    return (
      segmentToSegmentDistanceSquared(
        start,
        end,
        stroke.points[0],
        stroke.points[0],
      ) <= toleranceSquared
    );
  }
  for (const block of blocks) {
    if (stats) stats.blockBoundsTests += 1;
    if (!overlaps(block.bounds, query)) continue;
    for (let index = block.firstSegment; index < block.endSegment; index += 1) {
      if (stats) stats.segmentTests += 1;
      if (
        segmentToSegmentDistanceSquared(
          start,
          end,
          stroke.points[index - 1],
          stroke.points[index],
        ) <= toleranceSquared
      )
        return true;
    }
  }
  return false;
}
