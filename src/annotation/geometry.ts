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
    (Math.abs(fourth) <= epsilon &&
      onSegment(firstEnd, secondStart, secondEnd))
  );
}

function segmentToSegmentDistanceSquared(
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

export function eraserSweepHitsStroke(
  start: AnnotationPoint,
  end: AnnotationPoint,
  stroke: AnnotationStroke,
  eraserRadius: number,
) {
  if (!stroke.points.length) return false;

  const tolerance = Math.max(0, eraserRadius) + stroke.width / 2;
  const toleranceSquared = tolerance * tolerance;
  if (stroke.points.length === 1) {
    return (
      pointToSegmentDistanceSquared(stroke.points[0], start, end) <=
      toleranceSquared
    );
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      segmentToSegmentDistanceSquared(
        start,
        end,
        stroke.points[index - 1],
        stroke.points[index],
      ) <= toleranceSquared
    ) {
      return true;
    }
  }

  return false;
}
