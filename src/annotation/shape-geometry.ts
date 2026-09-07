import type { AnnotationElement, AnnotationPoint, InkElement, ShapeTool } from "./history.js";
import { frameCorners, framePoint, frameCoordinates, pointInFrame } from "./primitive-frame.js";

export interface InkBounds { minX: number; minY: number; maxX: number; maxY: number }
export const ELLIPSE_FLATTENING_ERROR = 0.125;
export const MAX_ELLIPSE_FLATTENING_SEGMENTS = 512;

export function constrainedShapeEnd(tool: ShapeTool, start: AnnotationPoint, end: AnnotationPoint, shift: boolean): AnnotationPoint {
  if (!shift) return { ...end };
  const dx = end.x - start.x, dy = end.y - start.y;
  if (tool === "rectangle" || tool === "ellipse") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

export function hasShapeExtent(tool: ShapeTool, start: AnnotationPoint, end: AnnotationPoint) {
  return tool === "line" || tool === "arrow" ? Math.hypot(end.x - start.x, end.y - start.y) >= 1
    : Math.abs(end.x - start.x) >= 1 && Math.abs(end.y - start.y) >= 1;
}

function ellipseRadiusBound(element: InkElement) {
  if (element.tool !== "ellipse") return 0;
  const [a, xEnd, yEnd] = element.points;
  if (!a || !xEnd || !yEnd) return 0;
  // The Frobenius norm bounds the ellipse frame's largest singular value.
  return Math.hypot(xEnd.x - a.x, xEnd.y - a.y, yEnd.x - a.x, yEnd.y - a.y) / 2;
}

function ellipseFlatteningSegments(radiusBound: number) {
  if (!radiusBound) return 1;
  const requested = Math.max(16, Math.ceil(Math.PI * Math.sqrt(radiusBound / (2 * ELLIPSE_FLATTENING_ERROR))));
  return Math.min(MAX_ELLIPSE_FLATTENING_SEGMENTS, requested);
}

/** Conservative world-space chord error after the pathological-work cap is applied. */
export function ellipseFlatteningTolerance(element: InkElement) {
  const radiusBound = ellipseRadiusBound(element);
  if (!radiusBound) return 0;
  const segments = ellipseFlatteningSegments(radiusBound);
  return Math.max(
    ELLIPSE_FLATTENING_ERROR,
    radiusBound * (1 - Math.cos(Math.PI / segments)),
  );
}

/** Exact linear paths and a bounded world-space flattening for ellipse hit tests.
 * Normal screen-sized ellipses retain the requested error tolerance. Pathological
 * off-screen frames are capped so a valid document cannot create unbounded
 * derived arrays. Ellipse storage and Canvas rendering remain analytic. */
export function elementInkPaths(element: InkElement): readonly (readonly AnnotationPoint[])[] {
  const [a, b] = element.points;
  if (!a) return [];
  if (element.tool === "pen" || element.tool === "highlighter" || element.tool === "line") return [element.points];
  if (!b) return [];
  if (element.tool === "arrow") {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return [[a]];
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
    const head = Math.min(Math.max(12, element.width * 4), length / 2), half = head * 0.45;
    return [[a, b], [{ x: b.x - ux * head - uy * half, y: b.y - uy * head + ux * half }, b,
      { x: b.x - ux * head + uy * half, y: b.y - uy * head - ux * half }]];
  }
  if (element.tool === "rectangle") {
    const corners = frameCorners(element.points);
    return [[...corners, corners[0]]];
  }
  const radiusBound = ellipseRadiusBound(element);
  if (!radiusBound) return [[a]];
  const count = ellipseFlatteningSegments(radiusBound);
  const points = Array.from({ length: count }, (_, i) => {
    const angle = 2 * Math.PI * i / count;
    return framePoint(element.points, (1 + Math.cos(angle)) / 2, (1 + Math.sin(angle)) / 2);
  });
  points.push(points[0]);
  return [points];
}

export function textOutline(element: Extract<AnnotationElement, { tool: "text" }>): readonly AnnotationPoint[] {
  const corners = frameCorners(element.points, element.box);
  return [...corners, corners[0]];
}

/** Exact interior hit in local coordinates; outline-only shapes never hit inside. */
export function pointInElementFill(point: AnnotationPoint, element: AnnotationElement): boolean {
  if (element.tool === "text") return pointInFrame(point, element.points, element.box);
  if ((element.tool !== "rectangle" && element.tool !== "ellipse") || element.fill === undefined) return false;
  const local = frameCoordinates(point, element.points);
  if (!local) return false;
  if (element.tool === "rectangle") return local.x >= 0 && local.x <= 1 && local.y >= 0 && local.y <= 1;
  return (local.x - 0.5) ** 2 + (local.y - 0.5) ** 2 <= 0.25;
}

const boundsCache = new WeakMap<AnnotationElement, InkBounds>();

export function elementInkBounds(element: AnnotationElement): InkBounds {
  const cached = boundsCache.get(element);
  if (cached) return cached;
  let bounds: InkBounds;
  if (element.tool === "ellipse") {
    const [a, b, c] = element.points;
    const center = framePoint(element.points, 0.5, 0.5);
    const rx = Math.hypot(b.x - a.x, c.x - a.x) / 2;
    const ry = Math.hypot(b.y - a.y, c.y - a.y) / 2;
    bounds = { minX: center.x - rx - element.width / 2, maxX: center.x + rx + element.width / 2,
      minY: center.y - ry - element.width / 2, maxY: center.y + ry + element.width / 2 };
  } else {
    const paths = element.tool === "text" ? [textOutline(element)] : elementInkPaths(element);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const points of paths) for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const padding = element.tool === "text" ? 0 : element.width / 2;
    bounds = { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
  }
  boundsCache.set(element, bounds);
  return bounds;
}
