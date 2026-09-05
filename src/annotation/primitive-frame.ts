import type { AnnotationPoint } from "./history.js";
import type { TextInkBox } from "./text.js";

/** Three world-space control points describe an affine frame: origin, x end, y end.
 * Unlike an angle plus two axis-aligned corners, this survives rotation followed
 * by nonuniform resizing without discarding shear or flattening an ellipse. */
export function shapeControlPoints(tool: string, start: AnnotationPoint, end: AnnotationPoint): AnnotationPoint[] {
  return tool === "rectangle" || tool === "ellipse"
    ? [{ ...start }, { x: end.x, y: start.y }, { x: start.x, y: end.y }]
    : [{ ...start }, { ...end }];
}

export function textControlPoints(origin: AnnotationPoint, scaleX = 1, scaleY = 1): AnnotationPoint[] {
  return [{ ...origin }, { x: origin.x + scaleX, y: origin.y }, { x: origin.x, y: origin.y + scaleY }];
}

export function framePoint(points: readonly AnnotationPoint[], x: number, y: number): AnnotationPoint {
  const [origin, xEnd, yEnd] = points;
  return {
    x: origin.x + (xEnd.x - origin.x) * x + (yEnd.x - origin.x) * y,
    y: origin.y + (xEnd.y - origin.y) * x + (yEnd.y - origin.y) * y,
  };
}

export function frameCorners(points: readonly AnnotationPoint[], box: TextInkBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 }): AnnotationPoint[] {
  return [framePoint(points, box.minX, box.minY), framePoint(points, box.maxX, box.minY),
    framePoint(points, box.maxX, box.maxY), framePoint(points, box.minX, box.maxY)];
}

/** Convex affine rectangles, including rotated text layout areas. */
export function frameCoordinates(point: AnnotationPoint, points: readonly AnnotationPoint[]): AnnotationPoint | null {
  if (points.length !== 3) return null;
  const [origin, xEnd, yEnd] = points;
  const a = xEnd.x - origin.x, b = xEnd.y - origin.y;
  const c = yEnd.x - origin.x, d = yEnd.y - origin.y;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  const x = (d * dx - c * dy) / determinant;
  const y = (a * dy - b * dx) / determinant;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function pointInFrame(point: AnnotationPoint, points: readonly AnnotationPoint[], box: TextInkBox): boolean {
  const local = frameCoordinates(point, points);
  return local !== null && local.x >= box.minX && local.x <= box.maxX && local.y >= box.minY && local.y <= box.maxY;
}

export function validTextFrame(points: readonly AnnotationPoint[], box: TextInkBox, coordinateLimit: number): boolean {
  if (points.length !== 3) return false;
  const [origin, xEnd, yEnd] = points;
  const a = xEnd.x - origin.x, b = xEnd.y - origin.y;
  const c = yEnd.x - origin.x, d = yEnd.y - origin.y;
  const xScale = Math.hypot(a, b), yScale = Math.hypot(c, d);
  const determinant = a * d - b * c;
  return xScale > 0 && yScale > 0 && xScale <= 100_000 && yScale <= 100_000 &&
    // Either orientation is valid. Reflection reverses it without collapsing the frame.
    Number.isFinite(determinant) && determinant !== 0 &&
    frameCorners(points, box).every(p => Number.isFinite(p.x) && Number.isFinite(p.y) &&
      Math.abs(p.x) <= coordinateLimit && Math.abs(p.y) <= coordinateLimit);
}
