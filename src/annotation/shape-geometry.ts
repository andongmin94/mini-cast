import type {
  AnnotationElement,
  AnnotationPoint,
  InkElement,
  ShapeTool,
} from "./history.js";

export interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const ELLIPSE_FLATTENING_ERROR = 0.125;

export function constrainedShapeEnd(
  tool: ShapeTool,
  start: AnnotationPoint,
  end: AnnotationPoint,
  shift: boolean,
): AnnotationPoint {
  if (!shift) return { ...end };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (tool === "rectangle" || tool === "ellipse") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: start.x + (dx < 0 ? -side : side),
      y: start.y + (dy < 0 ? -side : side),
    };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return {
    x: start.x + Math.cos(angle) * length,
    y: start.y + Math.sin(angle) * length,
  };
}

export function hasShapeExtent(
  tool: ShapeTool,
  start: AnnotationPoint,
  end: AnnotationPoint,
) {
  return tool === "line" || tool === "arrow"
    ? Math.hypot(end.x - start.x, end.y - start.y) >= 1
    : Math.abs(end.x - start.x) >= 1 && Math.abs(end.y - start.y) >= 1;
}

/** Exact linear paths; ellipses are flattened only for hit testing, never storage. */
export function elementInkPaths(
  element: InkElement,
): readonly (readonly AnnotationPoint[])[] {
  const [a, b] = element.points;
  if (!a) return [];
  if (
    element.tool === "pen" ||
    element.tool === "highlighter" ||
    element.tool === "line"
  ) {
    return [element.points];
  }
  if (!b) return [];
  if (element.tool === "arrow") {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return [[a]];
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const head = Math.min(Math.max(12, element.width * 4), length / 2);
    const half = head * 0.45;
    return [
      [a, b],
      [
        { x: b.x - ux * head - uy * half, y: b.y - uy * head + ux * half },
        b,
        { x: b.x - ux * head + uy * half, y: b.y - uy * head - ux * half },
      ],
    ];
  }
  if (element.tool === "rectangle") {
    return [[a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]];
  }
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  if (!rx || !ry) return [[a, b]];
  // Sagitta <= r*pi^2/(2*n^2). Adding this tolerance to the eraser prevents gaps.
  const count = Math.max(
    16,
    Math.ceil(Math.PI * Math.sqrt(Math.max(rx, ry) / (2 * ELLIPSE_FLATTENING_ERROR))),
  );
  const points = Array.from({ length: count }, (_, index) => ({
    x: cx + rx * Math.cos((2 * Math.PI * index) / count),
    y: cy + ry * Math.sin((2 * Math.PI * index) / count),
  }));
  points.push(points[0]);
  return [points];
}

const boundsCache = new WeakMap<AnnotationElement, InkBounds>();

export function elementInkBounds(element: AnnotationElement): InkBounds {
  const cached = boundsCache.get(element);
  if (cached) return cached;
  let bounds: InkBounds;
  if (element.tool === "text") {
    const point = element.points[0];
    bounds = {
      minX: point.x + element.box.minX * element.scaleX,
      minY: point.y + element.box.minY * element.scaleY,
      maxX: point.x + element.box.maxX * element.scaleX,
      maxY: point.y + element.box.maxY * element.scaleY,
    };
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    // An ellipse fits its anchor rectangle exactly; do not sample it for bounds.
    const paths = element.tool === "ellipse" ? [element.points] : elementInkPaths(element);
    for (const points of paths) {
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
    const radius = element.width / 2;
    bounds = {
      minX: minX - radius,
      minY: minY - radius,
      maxX: maxX + radius,
      maxY: maxY + radius,
    };
  }
  boundsCache.set(element, bounds);
  return bounds;
}
