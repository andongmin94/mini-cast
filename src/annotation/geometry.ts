import type { AnnotationPoint, AnnotationElement } from "./history.js";
import { pointInElementFill, textOutline, elementInkPaths, ellipseFlatteningTolerance, type InkBounds } from "./shape-geometry.js";

export function distanceSquared(left: AnnotationPoint, right: AnnotationPoint) {
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
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
    lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  return distanceSquared(point, {
    x: start.x + segmentX * clamped,
    y: start.y + segmentY * clamped,
  });
}

function orientation(
  first: AnnotationPoint,
  second: AnnotationPoint,
  third: AnnotationPoint,
) {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function onSegment(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
) {
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function segmentsIntersect(
  firstStart: AnnotationPoint,
  firstEnd: AnnotationPoint,
  secondStart: AnnotationPoint,
  secondEnd: AnnotationPoint,
) {
  const first = orientation(firstStart, firstEnd, secondStart);
  const second = orientation(firstStart, firstEnd, secondEnd);
  const third = orientation(secondStart, secondEnd, firstStart);
  const fourth = orientation(secondStart, secondEnd, firstEnd);

  if (
    ((first > 0 && second < 0) || (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))
  ) {
    return true;
  }

  const epsilon = 1e-9;
  return (
    (Math.abs(first) <= epsilon &&
      onSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(second) <= epsilon &&
      onSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(third) <= epsilon &&
      onSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(fourth) <= epsilon && onSegment(firstEnd, secondStart, secondEnd))
  );
}

export function segmentToSegmentDistanceSquared(
  firstStart: AnnotationPoint,
  firstEnd: AnnotationPoint,
  secondStart: AnnotationPoint,
  secondEnd: AnnotationPoint,
) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }

  return Math.min(
    pointToSegmentDistanceSquared(firstStart, secondStart, secondEnd),
    pointToSegmentDistanceSquared(firstEnd, secondStart, secondEnd),
    pointToSegmentDistanceSquared(secondStart, firstStart, firstEnd),
    pointToSegmentDistanceSquared(secondEnd, firstStart, firstEnd),
  );
}

export function pointInsideBounds(point: AnnotationPoint, bounds: InkBounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

export function rectangleOutline(bounds: InkBounds): readonly AnnotationPoint[] {
  const a = { x: bounds.minX, y: bounds.minY };
  return [a, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }, a];
}

export function pointHitsStroke(point: AnnotationPoint, element: AnnotationElement, eraserRadius: number) {
  return eraserSweepHitsStroke(point, point, element, eraserRadius);
}

/** Exhaustive reference kernel for object erasing; no interior hit for hollow shapes. */
export function eraserSweepHitsStroke(start: AnnotationPoint, end: AnnotationPoint, element: AnnotationElement, eraserRadius: number) {
  if (!element.points.length) return false;
  if (pointInElementFill(start, element) || pointInElementFill(end, element)) return true;
  let paths: readonly (readonly AnnotationPoint[])[];
  let tolerance = Math.max(0, eraserRadius);
  if (element.tool === "text") {
    paths = [textOutline(element)];
  } else {
    paths = elementInkPaths(element);
    tolerance += element.width / 2 + ellipseFlatteningTolerance(element);
  }
  for (const points of paths) {
    if (points.length === 1 && pointToSegmentDistanceSquared(points[0], start, end) <= tolerance * tolerance) return true;
    for (let i = 1;i < points.length;i++) {
      if (segmentToSegmentDistanceSquared(start, end, points[i - 1], points[i]) <= tolerance * tolerance) return true;
    }
  }
  return false;
}
