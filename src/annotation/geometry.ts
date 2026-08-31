import type { AnnotationPoint, AnnotationStroke } from "./history.js";

export function distanceSquared(
  left: AnnotationPoint,
  right: AnnotationPoint,
) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistanceSquared(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return distanceSquared(point, start);

  const projection =
    ((point.x - start.x) * segmentX +
      (point.y - start.y) * segmentY) /
    lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  return distanceSquared(point, {
    x: start.x + segmentX * clamped,
    y: start.y + segmentY * clamped,
  });
}

export function pointHitsStroke(
  point: AnnotationPoint,
  stroke: AnnotationStroke,
  eraserRadius: number,
) {
  if (!stroke.points.length) return false;

  const tolerance = Math.max(0, eraserRadius) + stroke.width / 2;
  const toleranceSquared = tolerance * tolerance;
  if (stroke.points.length === 1) {
    return distanceSquared(point, stroke.points[0]) <= toleranceSquared;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      pointToSegmentDistanceSquared(
        point,
        stroke.points[index - 1],
        stroke.points[index],
      ) <= toleranceSquared
    ) {
      return true;
    }
  }

  return false;
}
